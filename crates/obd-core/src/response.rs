//! Parsing of raw ELM327 text into OBD-II messages.
//!
//! The adapter answers with text lines such as:
//!
//! ```text
//! 41 0C 1A F8            <- single frame
//! 014                    <- CAN ISO-TP: total length (hex) of a long answer
//! 0: 49 02 01 31 47 31   <- CAN ISO-TP: frame 0
//! 1: 4A 43 35 34 34 34 52
//! ```
//!
//! Clones are inconsistent: some keep the echo on, add `SEARCHING...`, send
//! NULL bytes, drop spaces or forget the final `OK`. This module cleans all of
//! that before decoding.

use crate::{ObdError, Result};

/// Cleans a raw reply: removes the prompt, NULs, echo, status chatter and
/// blank lines. Returns the meaningful lines.
pub fn clean_lines(raw: &str, sent_command: &str) -> Vec<String> {
    let cmd_norm = compact(sent_command);
    let text: String = raw.chars().filter(|&c| c != '\0' && c != '>').collect();
    let mut lines = Vec::new();
    for line in text.split(['\r', '\n']) {
        let mut line = line.trim().to_string();
        // "BUS INIT: ...OK" and "SEARCHING..." may prefix the data on the same line.
        for prefix in [
            "SEARCHING...",
            "BUS INIT: ...OK",
            "BUS INIT: ...",
            "BUS INIT:",
        ] {
            if let Some(rest) = line.to_ascii_uppercase().strip_prefix(prefix) {
                line = line[line.len() - rest.len()..].trim().to_string();
            }
        }
        if line.is_empty() {
            continue;
        }
        // Echo of the command (with or without spaces).
        if !cmd_norm.is_empty() && compact(&line) == cmd_norm && lines.is_empty() {
            continue;
        }
        lines.push(line);
    }
    lines
}

fn compact(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase()
}

/// Maps adapter status words to errors. Returns `Ok(())` when the lines look
/// like data.
pub fn check_errors(lines: &[String]) -> Result<()> {
    if lines.is_empty() {
        return Err(ObdError::NoData);
    }
    let all_text: Vec<String> = lines.iter().map(|l| l.to_ascii_uppercase()).collect();
    let has_data = all_text
        .iter()
        .any(|l| parse_hex_line(l).is_some() || is_frame_line(l));
    for l in &all_text {
        let l = l.as_str();
        if l == "?" {
            return Err(ObdError::UnknownCommand);
        }
        if l.contains("UNABLE TO CONNECT") {
            return Err(ObdError::UnableToConnect);
        }
        if !has_data {
            if l.contains("NO DATA") || l == "STOPPED" {
                return Err(ObdError::NoData);
            }
            for word in [
                "CAN ERROR",
                "BUS ERROR",
                "BUS BUSY",
                "FB ERROR",
                "DATA ERROR",
                "RX ERROR",
                "BUFFER FULL",
                "LV RESET",
                "ACT ALERT",
                "ERR",
            ] {
                if l.contains(word) {
                    return Err(ObdError::Bus(l.to_string()));
                }
            }
        }
    }
    Ok(())
}

fn is_frame_line(l: &str) -> bool {
    split_frame_index(l).is_some()
}

/// `"1: 4A 43"` -> `Some((1, "4A 43"))`
fn split_frame_index(l: &str) -> Option<(u8, &str)> {
    let (idx, rest) = l.split_once(':')?;
    let idx = idx.trim();
    if idx.len() == 1 {
        u8::from_str_radix(idx, 16).ok().map(|i| (i, rest))
    } else {
        None
    }
}

/// Parses `"41 0C 1A F8"` or `"410C1AF8"` into bytes.
pub fn parse_hex_line(l: &str) -> Option<Vec<u8>> {
    let hex: String = l.chars().filter(|c| !c.is_whitespace()).collect();
    if hex.is_empty() || hex.len() % 2 != 0 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

/// Turns cleaned lines into complete messages, joining CAN multi-frame answers.
/// Lines that are not hex data are ignored.
pub fn assemble_messages(lines: &[String]) -> Vec<Vec<u8>> {
    let mut messages: Vec<Vec<u8>> = Vec::new();
    // Multi-frame message being assembled: (declared length, bytes).
    let mut multi: Option<(usize, Vec<u8>)> = None;

    let flush = |multi: &mut Option<(usize, Vec<u8>)>, messages: &mut Vec<Vec<u8>>| {
        if let Some((len, mut bytes)) = multi.take() {
            if len > 0 && bytes.len() > len {
                bytes.truncate(len); // remove padding of the last frame
            }
            if !bytes.is_empty() {
                messages.push(bytes);
            }
        }
    };

    for line in lines {
        let compacted = compact(line);
        // A 3-hex-digit line announces the length of an ISO-TP message.
        if compacted.len() == 3 && compacted.chars().all(|c| c.is_ascii_hexdigit()) {
            flush(&mut multi, &mut messages);
            let len = usize::from_str_radix(&compacted, 16).unwrap_or(0);
            multi = Some((len, Vec::new()));
            continue;
        }
        if let Some((idx, rest)) = split_frame_index(line) {
            if let Some(bytes) = parse_hex_line(rest) {
                if idx == 0 && multi.as_ref().is_some_and(|(_, b)| !b.is_empty()) {
                    // A new frame 0 without length line: new message.
                    flush(&mut multi, &mut messages);
                }
                multi.get_or_insert((0, Vec::new())).1.extend(bytes);
            }
            continue;
        }
        if let Some(bytes) = parse_hex_line(line) {
            flush(&mut multi, &mut messages);
            messages.push(bytes);
        }
    }
    flush(&mut multi, &mut messages);
    messages
}

/// Keeps only the messages that answer `mode` (positive response = mode + 0x40)
/// and, when given, start with the request bytes after the mode (e.g. the PID).
/// A negative response (`7F <mode> <code>`) becomes an error if nothing else
/// answered.
pub fn filter_responses(messages: Vec<Vec<u8>>, mode: u8, echo: &[u8]) -> Result<Vec<Vec<u8>>> {
    let positive = mode.wrapping_add(0x40);
    let mut negative = None;
    let mut out = Vec::new();
    for m in messages {
        if m.len() >= 3 && m[0] == 0x7F && m[1] == mode {
            negative = Some(m[2]);
            continue;
        }
        if m.first() == Some(&positive) && m.len() > echo.len() && m[1..=echo.len()] == *echo {
            out.push(m);
        }
    }
    if out.is_empty() {
        return Err(match negative {
            Some(code) => ObdError::NegativeResponse(code),
            None => ObdError::NoData,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn cleans_echo_searching_and_nulls() {
        let raw = "010C\r\0SEARCHING...\r41 0C 1A F8 \r\r>";
        assert_eq!(clean_lines(raw, "010C"), lines(&["41 0C 1A F8"]));
        let raw = "SEARCHING...41 0C 1A F8\r>";
        assert_eq!(clean_lines(raw, "01 0C"), lines(&["41 0C 1A F8"]));
    }

    #[test]
    fn parses_hex_with_and_without_spaces() {
        assert_eq!(
            parse_hex_line("41 0C 1A F8"),
            Some(vec![0x41, 0x0C, 0x1A, 0xF8])
        );
        assert_eq!(
            parse_hex_line("410C1AF8"),
            Some(vec![0x41, 0x0C, 0x1A, 0xF8])
        );
        assert_eq!(parse_hex_line("NO DATA"), None);
        assert_eq!(parse_hex_line("41 0"), None);
    }

    #[test]
    fn assembles_can_multiframe_vin() {
        let l = lines(&[
            "014",
            "0: 49 02 01 31 47 31",
            "1: 4A 43 35 34 34 34 52",
            "2: 37 32 35 32 33 36 37",
        ]);
        let msgs = assemble_messages(&l);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].len(), 0x14);
        assert_eq!(&msgs[0][..3], &[0x49, 0x02, 0x01]);
    }

    #[test]
    fn multiple_ecus_give_multiple_messages() {
        let l = lines(&["41 00 BE 3E B8 11", "41 00 80 00 00 00"]);
        assert_eq!(assemble_messages(&l).len(), 2);
    }

    #[test]
    fn errors_are_detected() {
        assert!(matches!(
            check_errors(&lines(&["NO DATA"])),
            Err(ObdError::NoData)
        ));
        assert!(matches!(
            check_errors(&lines(&["?"])),
            Err(ObdError::UnknownCommand)
        ));
        assert!(matches!(
            check_errors(&lines(&["UNABLE TO CONNECT"])),
            Err(ObdError::UnableToConnect)
        ));
        assert!(matches!(
            check_errors(&lines(&["CAN ERROR"])),
            Err(ObdError::Bus(_))
        ));
        assert!(check_errors(&lines(&["41 0C 1A F8"])).is_ok());
    }

    #[test]
    fn filter_keeps_matching_pid_and_reports_negative() {
        let msgs = vec![vec![0x41, 0x0D, 0x20], vec![0x41, 0x0C, 0x1A, 0xF8]];
        let r = filter_responses(msgs, 0x01, &[0x0C]).unwrap();
        assert_eq!(r, vec![vec![0x41, 0x0C, 0x1A, 0xF8]]);
        let neg = filter_responses(vec![vec![0x7F, 0x01, 0x12]], 0x01, &[0x0C]);
        assert!(matches!(neg, Err(ObdError::NegativeResponse(0x12))));
    }
}
