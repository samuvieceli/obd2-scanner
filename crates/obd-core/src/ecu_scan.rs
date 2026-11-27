//! ECU scan: which control units answer OBD requests, and who they are.
//!
//! With headers on (`ATH1`) every answer line starts with the address of the
//! control unit that sent it, so one `0100` request lists all units that
//! speak OBD (engine, transmission, hybrid system...). On CAN cars each unit
//! is then asked directly for its name (mode 09 PID 0A) and for the standard
//! UDS identification records (service 0x22, ISO 14229): part number,
//! software version, supplier... Everything here only reads.
//! Idea from DDT4ALL's ECU scanner (GPL-3.0), which does the same with a
//! Renault database; here only standard requests are used.

use serde::Serialize;

use crate::elm327::Elm327;
use crate::pid::decode_supported;
use crate::response::{check_errors, parse_hex_line};
use crate::vin::assemble_mode09_string;
use crate::{ObdError, Result};

/// Standard UDS identification records (ISO 14229-1, annex C), read in this order.
pub const DIDS: &[(u16, &str)] = &[
    (0xF190, "vin"),
    (0xF187, "part_number"),
    (0xF18A, "supplier"),
    (0xF191, "hardware_number"),
    (0xF188, "software_number"),
    (0xF195, "software_version"),
    (0xF18C, "serial_number"),
    (0xF197, "system_name"),
];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EcuId {
    pub key: &'static str,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EcuInfo {
    /// Address the unit answers from (`7E8`, `18DAF110`, `10`).
    pub address: String,
    /// `engine`, `transmission` or `other` (usual addresses, not guaranteed).
    pub role: &'static str,
    /// Mode 01 PIDs it reports in the 01-20 range.
    pub supported_pids: usize,
    /// Name from mode 09 PID 0A.
    pub name: Option<String>,
    /// UDS identification records the unit answered.
    pub ids: Vec<EcuId>,
}

/// One answer line with headers on: `(sender address, data bytes)`.
/// CAN lines carry a PCI byte (single frame length) that is removed;
/// older protocols end with a checksum byte that is removed too.
pub fn parse_headed_line(line: &str, can: bool) -> Option<(String, Vec<u8>)> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if can && tokens.first()?.len() == 3 {
        // 11-bit CAN: "7E8 06 41 00 BE 3F A8 13"
        let bytes = parse_hex_line(&tokens[1..].join(" "))?;
        return Some((tokens[0].to_ascii_uppercase(), single_frame(&bytes)?));
    }
    let bytes = parse_hex_line(&tokens.join(" "))?;
    if can {
        // 29-bit CAN: "18 DA F1 10 06 41 00 ..."
        let (head, rest) = (bytes.get(..4)?, bytes.get(4..)?);
        let address: String = head.iter().map(|b| format!("{b:02X}")).collect();
        return Some((address, single_frame(rest)?));
    }
    // J1850 / ISO 9141 / KWP: priority, target, source, data..., checksum
    let data = bytes.get(3..bytes.len().checked_sub(1)?)?;
    Some((format!("{:02X}", bytes[2]), data.to_vec()))
}

fn single_frame(bytes: &[u8]) -> Option<Vec<u8>> {
    let pci = *bytes.first()?;
    let len = (pci & 0x0F) as usize;
    (pci >> 4 == 0 && len > 0).then(|| bytes.get(1..1 + len).map(<[u8]>::to_vec))?
}

/// Usual role of a unit from its address (SAE J1979 / ISO 15765-4 habits).
pub fn role_of(address: &str) -> &'static str {
    let source = &address[address.len().saturating_sub(2)..];
    match (address.len(), address, source) {
        (3, "7E8", _) | (8, _, "10") | (2, _, "10") => "engine",
        (3, "7E9", _) | (8, _, "18") | (2, _, "18") => "transmission",
        _ => "other",
    }
}

/// Physical request header for a unit, CAN only (`7E8` → `7E0`,
/// `18DAF110` → `DA10F1` with the default priority 18).
pub fn request_header(address: &str) -> Option<String> {
    match address.len() {
        3 => {
            let id = u16::from_str_radix(address, 16).ok()?;
            Some(format!("{:03X}", id.checked_sub(8)?))
        }
        8 => Some(format!("DA{}F1", &address[6..8])),
        _ => None,
    }
}

/// Text of an identification record: printable ASCII, otherwise hex.
fn did_text(data: &[u8]) -> Option<String> {
    // Units pad records with 0x00, 0xFF or spaces at either end.
    let pad = |b: &u8| matches!(*b, 0 | 0xFF | b' ');
    let first = data.iter().position(|b| !pad(b))?;
    let last = data.iter().rposition(|b| !pad(b))?;
    let core = &data[first..=last];
    if core.iter().all(|b| b.is_ascii_graphic() || *b == b' ') {
        Some(String::from_utf8_lossy(core).into_owned())
    } else {
        Some(data.iter().map(|b| format!("{b:02X}")).collect())
    }
}

/// Finds the units, then asks each one (CAN) for its identity. The adapter
/// is reset and reconfigured at the end, whatever happened.
pub fn scan_ecus(elm: &mut Elm327) -> Result<Vec<EcuInfo>> {
    let result = scan_inner(elm);
    let restored = elm.reconfigure();
    let list = result?;
    match restored {
        Err(e @ (ObdError::Io(_) | ObdError::Connection(_) | ObdError::Port(..))) => Err(e),
        _ => Ok(list),
    }
}

fn scan_inner(elm: &mut Elm327) -> Result<Vec<EcuInfo>> {
    let can = elm.info.is_can();
    elm.command("ATH1")?;
    let lines = elm.command("0100")?;
    check_errors(&lines)?;
    let mut ecus: Vec<EcuInfo> = Vec::new();
    for (address, data) in lines.iter().filter_map(|l| parse_headed_line(l, can)) {
        if data.len() < 6 || data[0] != 0x41 || data[1] != 0x00 {
            continue;
        }
        let count = decode_supported(0x00, &data[2..6])
            .iter()
            .filter(|p| **p <= 0x20)
            .count();
        if !ecus.iter().any(|e| e.address == address) {
            ecus.push(EcuInfo {
                role: role_of(&address),
                address,
                supported_pids: count,
                name: None,
                ids: Vec::new(),
            });
        }
    }
    elm.command("ATH0")?;
    ecus.sort_by(|a, b| a.address.cmp(&b.address));
    if !can {
        return Ok(ecus);
    }
    for ecu in &mut ecus {
        let Some(header) = request_header(&ecu.address) else {
            continue;
        };
        let accepted = elm.command(&format!("ATSH{header}"))?;
        if accepted.iter().any(|l| l.trim() == "?") {
            continue;
        }
        ecu.name = elm
            .request(0x09, &[0x0A])
            .ok()
            .and_then(|m| assemble_mode09_string(&m, true));
        for (did, key) in DIDS {
            match elm.request(0x22, &[(did >> 8) as u8, *did as u8]) {
                Ok(msgs) => {
                    if let Some(value) = msgs.first().and_then(|m| did_text(&m[3..])) {
                        ecu.ids.push(EcuId { key, value });
                    }
                }
                Err(ObdError::NegativeResponse(_)) => {}
                // No answer at all: this unit does not speak UDS.
                Err(ObdError::Timeout | ObdError::NoData) if ecu.ids.is_empty() => break,
                Err(e @ (ObdError::Io(_) | ObdError::Connection(_) | ObdError::Port(..))) => {
                    return Err(e);
                }
                Err(_) => {}
            }
        }
    }
    Ok(ecus)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_11_bit_can() {
        let (a, d) = parse_headed_line("7E8 06 41 00 BE 3F A8 13", true).unwrap();
        assert_eq!(a, "7E8");
        assert_eq!(d, vec![0x41, 0x00, 0xBE, 0x3F, 0xA8, 0x13]);
    }

    #[test]
    fn parses_29_bit_can() {
        let (a, d) = parse_headed_line("18 DA F1 18 06 41 00 80 00 00 01", true).unwrap();
        assert_eq!(a, "18DAF118");
        assert_eq!(d, vec![0x41, 0x00, 0x80, 0x00, 0x00, 0x01]);
        assert_eq!(role_of(&a), "transmission");
        assert_eq!(request_header(&a).as_deref(), Some("DA18F1"));
    }

    #[test]
    fn parses_j1850_with_checksum() {
        let (a, d) = parse_headed_line("48 6B 10 41 00 BE 1F B8 10 AA", false).unwrap();
        assert_eq!(a, "10");
        assert_eq!(d, vec![0x41, 0x00, 0xBE, 0x1F, 0xB8, 0x10]);
        assert_eq!(role_of(&a), "engine");
    }

    #[test]
    fn rejects_non_data_lines() {
        assert!(parse_headed_line("SEARCHING...", true).is_none());
        assert!(parse_headed_line("7E8 10 14 49 02 01 31 47 31", true).is_none());
    }

    #[test]
    fn request_headers() {
        assert_eq!(request_header("7E8").as_deref(), Some("7E0"));
        assert_eq!(request_header("7E9").as_deref(), Some("7E1"));
        assert_eq!(request_header("10"), None);
    }

    #[test]
    fn identification_text() {
        assert_eq!(did_text(b"03C906024AB \0").as_deref(), Some("03C906024AB"));
        assert_eq!(did_text(&[0x01, 0x02]).as_deref(), Some("0102"));
        assert_eq!(did_text(&[0, 0, 0]), None);
        assert_eq!(did_text(b"1K0907115\xFF\xFF").as_deref(), Some("1K0907115"));
    }
}
