//! Read-only guard for commands typed by the user.
//!
//! The program never writes to the car's control units (only reading, plus
//! clearing trouble codes on purpose with its own button). The AT terminal is
//! the one place where any text could reach the car, so every line typed
//! there goes through [`check_terminal_command`] first:
//!
//! - AT commands are allowed, except those that write to the adapter's own
//!   permanent memory or cut the link: `ATPP xx SV/ON/OFF` (`ATPPS` only
//!   lists them and stays allowed), `ATSD` (save data byte), `ATCV`
//!   (voltage calibration), `ATBRD`/`ATBRT` (baud rate change), plus `ATCAF0`,
//!   which would let a raw CAN frame hide a write behind a read service.
//! - The line is sent exactly as checked ([`normalize`]): no spaces, line
//!   breaks or invisible characters, so it cannot carry a second command.
//! - Car requests are allowed only for services that read: OBD modes 01, 02,
//!   03, 05, 06, 07, 09, 0A, KWP 1A/21 and UDS 19/22.
//! - Mode 04 / UDS 14 (clear codes) are refused here: the Trouble codes
//!   screen has a button that asks for confirmation and checks that the
//!   engine is off ([`crate::elm327::Elm327::clear_dtcs`]).
//! - Everything else (coding, actuator tests, resets, security access,
//!   programming...) is refused.

/// OBD / KWP / UDS services that only read.
const READ_SERVICES: &[u8] = &[
    0x01, 0x02, 0x03, 0x05, 0x06, 0x07, 0x09, 0x0A, // OBD-II (SAE J1979)
    0x19, 0x1A, 0x21, 0x22, // read DTC / ECU id / data (UDS, KWP 2000)
];

/// Why a command was refused. [`Blocked::code`] names the UI text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Blocked {
    /// Writes to the adapter's permanent memory or changes its baud rate.
    AdapterMemory,
    /// Clears trouble codes: use the button on the Trouble codes screen.
    ClearCodes,
    /// A service that changes something in the car.
    Write,
    /// Neither an AT command nor a hexadecimal request.
    Unknown,
}

impl Blocked {
    pub fn code(self) -> &'static str {
        match self {
            Blocked::AdapterMemory => "blocked_adapter_memory",
            Blocked::ClearCodes => "blocked_clear_codes",
            Blocked::Write => "blocked_write",
            Blocked::Unknown => "blocked_unknown",
        }
    }
}

/// The command as it is checked and sent: printable ASCII only, upper case.
/// Spaces, line breaks and invisible characters are removed, so one line can
/// never carry a second command (the ELM327 runs whatever follows a CR).
pub fn normalize(cmd: &str) -> String {
    cmd.chars()
        .filter(char::is_ascii_graphic)
        .collect::<String>()
        .to_ascii_uppercase()
}

/// Checks one terminal line; send [`normalize`]`(cmd)`, never the raw text.
pub fn check_terminal_command(cmd: &str) -> Result<(), Blocked> {
    let c = normalize(cmd);
    if c.is_empty() {
        return Ok(());
    }
    if let Some(at) = c.strip_prefix("AT") {
        // CAF0 turns CAN auto-formatting off: the first data byte typed is
        // then the frame length, so a write could pass as a mode 01-0A read.
        let writes = (at.starts_with("PP") && at != "PPS")
            || ["SD", "CV", "BRD", "BRT", "CAF0"]
                .iter()
                .any(|p| at.starts_with(p));
        return if writes {
            Err(Blocked::AdapterMemory)
        } else {
            Ok(())
        };
    }
    if c.len() < 2 || !c.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(Blocked::Unknown);
    }
    match u8::from_str_radix(&c[..2], 16) {
        Ok(0x04 | 0x14) => Err(Blocked::ClearCodes),
        Ok(s) if READ_SERVICES.contains(&s) => Ok(()),
        _ => Err(Blocked::Write),
    }
}

/// AT commands that only read: identification, voltage, protocol, status.
/// Anything else may change how the adapter talks to the car (headers,
/// spaces, protocol, a reset), so the program sets it up again afterwards.
const AT_READ_ONLY: &[&str] = &["", "I", "@1", "@2", "RV", "DP", "DPN", "PPS", "CS", "IGN", "RD"];

/// True when an allowed terminal command may leave the adapter set up
/// differently from what the program expects (see [`AT_READ_ONLY`]).
pub fn changes_adapter_setup(cmd: &str) -> bool {
    normalize(cmd)
        .strip_prefix("AT")
        .is_some_and(|at| !AT_READ_ONLY.contains(&at))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_changes_are_detected() {
        for c in ["ATZ", "ATH1", "AT S0", "ATSH7E0", "ATTP6", "ATSP0", "ATE1", "ATMA"] {
            assert!(changes_adapter_setup(c), "{c}");
        }
        for c in ["ATI", "ATRV", "at dp", "ATDPN", "ATPPS", "0100", "03", "0902"] {
            assert!(!changes_adapter_setup(c), "{c}");
        }
    }

    #[test]
    fn reading_commands_pass() {
        for cmd in [
            "ATI",
            "at rv",
            "ATPPS",
            "ATZ",
            "ATSP0",
            "ATSH7E0",
            "ATSIMHANG",
            "0100",
            "01 0C",
            "03",
            "0902",
            "22F190",
            "19 02 FF",
            "",
        ] {
            assert_eq!(check_terminal_command(cmd), Ok(()), "{cmd}");
        }
    }

    #[test]
    fn adapter_memory_writes_are_blocked() {
        for cmd in [
            "ATPP 0C SV 23",
            "ATPP0CON",
            "ATPPFFOFF",
            "ATSD 01",
            "ATCV1250",
            "AT BRD 23",
            "ATBRT",
        ] {
            assert_eq!(
                check_terminal_command(cmd),
                Err(Blocked::AdapterMemory),
                "{cmd}"
            );
        }
    }

    #[test]
    fn car_writes_and_clears_are_blocked() {
        assert_eq!(check_terminal_command("04"), Err(Blocked::ClearCodes));
        assert_eq!(
            check_terminal_command("14 FF FF FF"),
            Err(Blocked::ClearCodes)
        );
        for cmd in [
            "08 01",
            "2E F1 90 00",
            "31 01 FF 00",
            "27 01",
            "11 01",
            "10 03",
            "2F 01",
            "3B 90",
            "34",
            "85 02",
        ] {
            assert_eq!(check_terminal_command(cmd), Err(Blocked::Write), "{cmd}");
        }
        assert_eq!(
            check_terminal_command("STSBR 115200"),
            Err(Blocked::Unknown)
        );
        assert_eq!(check_terminal_command("hello"), Err(Blocked::Unknown));
        assert_eq!(
            check_terminal_command("AT CAF0"),
            Err(Blocked::AdapterMemory)
        );
        assert_eq!(check_terminal_command("ATCAF1"), Ok(()));
    }

    #[test]
    fn one_line_is_one_command() {
        // A second command after a line break or hidden by NUL bytes is
        // glued to the first one and checked as a whole.
        assert_eq!(normalize("ati\r\natpp0csv23"), "ATIATPP0CSV23");
        assert_eq!(normalize("AT\0PP 0C SV 23"), "ATPP0CSV23");
        assert_eq!(
            check_terminal_command("AT\0PP 0C SV 23"),
            Err(Blocked::AdapterMemory)
        );
        assert_eq!(normalize("01 0c"), "010C");
    }
}
