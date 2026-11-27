//! ELM327 protocol driver, written to survive cheap clones.
//!
//! Strategy:
//! * Generous, configurable timeouts (a clone may take 1-3 s to answer `ATZ`).
//! * Never rely on `OK` or on echo being off; [`crate::response`] cleans both.
//! * Commands that a clone does not support (`?`) are skipped during setup.
//! * A raw traffic log callback feeds the AT terminal in the UI.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::dtc::{decode_dtc_response, Dtc};
use crate::pid::{decode_supported, PidValue, PIDS};
use crate::readiness::{decode_readiness, Readiness};
use crate::response::{assemble_messages, check_errors, clean_lines, filter_responses};
use crate::transport::Transport;
use crate::vin::assemble_mode09_string;
use crate::{ObdError, Result};

/// Tunable timings and options. Defaults suit most adapters, including clones.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ElmConfig {
    /// Wait for a normal command (ms).
    pub command_timeout_ms: u64,
    /// Wait after `ATZ` reset (ms). Clones can be slow here.
    pub reset_timeout_ms: u64,
    /// Wait for the first OBD request, when the adapter searches the protocol (ms).
    pub search_timeout_ms: u64,
    /// OBD protocol for `ATSP`: `"0"` = automatic, `"6"` = CAN 11/500, etc.
    pub protocol: String,
    /// Optional `ATST` value (hex, 4 ms units) to speed up replies. Empty = adapter default.
    pub elm_timeout_hex: String,
}

impl Default for ElmConfig {
    fn default() -> Self {
        Self {
            command_timeout_ms: 2_000,
            reset_timeout_ms: 5_000,
            search_timeout_ms: 15_000,
            protocol: "0".into(),
            elm_timeout_hex: String::new(),
        }
    }
}

/// What we learned about the adapter and the vehicle bus during setup.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AdapterInfo {
    /// Text returned by `ATI`, e.g. `ELM327 v1.5`.
    pub version: String,
    /// Protocol name from `ATDP`.
    pub protocol: String,
    /// Protocol number from `ATDPN` (`"6"`, `"A6"`...).
    pub protocol_number: String,
    /// Transport description (`COM5 @ 38400`).
    pub transport: String,
    /// PIDs of mode 01 supported by the ECU.
    pub supported_pids: Vec<u8>,
}

impl AdapterInfo {
    /// CAN protocols (6-9, also when prefixed with `A` for "automatic").
    pub fn is_can(&self) -> bool {
        let n = self.protocol_number.trim_start_matches('A');
        matches!(n, "6" | "7" | "8" | "9")
    }
}

/// Direction of a logged line.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogDirection {
    Tx,
    Rx,
    Info,
}

pub type Logger = Box<dyn FnMut(LogDirection, &str) + Send>;

/// Vehicle identification read through mode 09.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VehicleIdentity {
    pub vin: Option<String>,
    pub calibration_id: Option<String>,
    pub ecu_name: Option<String>,
}

pub struct Elm327 {
    transport: Box<dyn Transport>,
    pub config: ElmConfig,
    pub info: AdapterInfo,
    logger: Option<Logger>,
}

impl Elm327 {
    pub fn new(transport: Box<dyn Transport>, config: ElmConfig) -> Self {
        let info = AdapterInfo {
            transport: transport.describe(),
            ..Default::default()
        };
        Self {
            transport,
            config,
            info,
            logger: None,
        }
    }

    pub fn set_logger(&mut self, logger: Logger) {
        self.logger = Some(logger);
    }

    fn log(&mut self, dir: LogDirection, text: &str) {
        if let Some(l) = self.logger.as_mut() {
            l(dir, text);
        }
    }

    /// Sends a command and returns the raw text up to the `>` prompt.
    pub fn raw_command(&mut self, cmd: &str, timeout: Duration) -> Result<String> {
        self.transport.clear_input()?;
        self.log(LogDirection::Tx, cmd);
        self.transport.write_all(format!("{cmd}\r").as_bytes())?;

        let deadline = Instant::now() + timeout;
        let mut out: Vec<u8> = Vec::new();
        let mut buf = [0u8; 512];
        loop {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            let n = self.transport.read(&mut buf, deadline - now)?;
            out.extend_from_slice(&buf[..n]);
            if out.contains(&b'>') {
                break;
            }
        }
        let text = String::from_utf8_lossy(&out).to_string();
        let shown = text.replace('\0', "").replace('\r', "\n");
        let shown = shown.trim_end_matches(['>', '\n', ' ']).trim().to_string();
        if !shown.is_empty() {
            self.log(LogDirection::Rx, &shown);
        }
        if !out.contains(&b'>') {
            if out.is_empty() {
                return Err(ObdError::Timeout);
            }
            // Some clones forget the prompt: keep what we got.
            self.log(
                LogDirection::Info,
                "no '>' prompt received, using partial answer",
            );
        }
        Ok(text)
    }

    /// Sends a command and returns the cleaned response lines.
    pub fn command(&mut self, cmd: &str) -> Result<Vec<String>> {
        let t = Duration::from_millis(self.config.command_timeout_ms);
        let raw = self.raw_command(cmd, t)?;
        Ok(clean_lines(&raw, cmd))
    }

    /// AT command that tolerates unsupported (`?`) answers. Returns `true` if accepted.
    fn at_optional(&mut self, cmd: &str) -> Result<bool> {
        match self.command(cmd) {
            Ok(lines) => Ok(!lines.iter().any(|l| l.trim() == "?")),
            Err(ObdError::Timeout) => {
                self.log(LogDirection::Info, &format!("{cmd}: no answer, ignoring"));
                Ok(false)
            }
            Err(e) => Err(e),
        }
    }

    /// Full setup: [`Self::setup_adapter`] then [`Self::connect_vehicle`].
    pub fn initialize(&mut self) -> Result<&AdapterInfo> {
        self.setup_adapter()?;
        self.connect_vehicle()
    }

    /// Step 1: reset and configure the adapter. Does not need the car.
    pub fn setup_adapter(&mut self) -> Result<()> {
        self.log(LogDirection::Info, "initializing adapter");
        // Wake-up: some adapters ignore the first command after opening the port.
        let _ = self.raw_command("", Duration::from_millis(300));
        let reset = Duration::from_millis(self.config.reset_timeout_ms);
        let lines = clean_lines(&self.raw_command("ATZ", reset)?, "ATZ");
        if let Some(v) = lines
            .iter()
            .find(|l| l.to_ascii_uppercase().contains("ELM"))
        {
            self.info.version = v.trim().to_string();
        }
        // Echo off, linefeeds off, spaces on, headers off, adaptive timing.
        for cmd in ["ATE0", "ATL0", "ATS1", "ATH0", "ATAT1"] {
            self.at_optional(cmd)?;
        }
        if let Ok(lines) = self.command("ATI") {
            if let Some(v) = lines.into_iter().find(|l| !l.trim().is_empty() && l != "?") {
                self.info.version = v;
            }
        }
        if !self.config.elm_timeout_hex.is_empty() {
            let st = format!("ATST{}", self.config.elm_timeout_hex);
            self.at_optional(&st)?;
        }
        let sp = format!("ATSP{}", self.config.protocol);
        self.at_optional(&sp)?;
        Ok(())
    }

    /// Step 2: talk to the vehicle (ignition must be on), detect the protocol
    /// and read the supported PIDs.
    pub fn connect_vehicle(&mut self) -> Result<&AdapterInfo> {
        // First OBD request: the adapter searches the protocol (can take seconds).
        let search = Duration::from_millis(self.config.search_timeout_ms);
        let raw = self.raw_command("0100", search)?;
        let lines = clean_lines(&raw, "0100");
        check_errors(&lines)?;
        let mut supported = Vec::new();
        let first = filter_responses(assemble_messages(&lines), 0x01, &[0x00])?;
        for m in &first {
            supported.extend(decode_supported(0x00, &m[2..]));
        }

        if let Ok(lines) = self.command("ATDPN") {
            self.info.protocol_number = lines.first().cloned().unwrap_or_default();
        }
        if let Ok(lines) = self.command("ATDP") {
            self.info.protocol = lines.first().cloned().unwrap_or_default();
        }

        // Ranges 0x20, 0x40... are only valid if the previous range says so.
        let mut base = 0x00u8;
        while supported.contains(&(base + 0x20)) && base < 0xC0 {
            base += 0x20;
            match self.request(0x01, &[base]) {
                Ok(msgs) => {
                    for m in &msgs {
                        supported.extend(decode_supported(base, &m[2..]));
                    }
                }
                Err(_) => break,
            }
        }
        supported.sort_unstable();
        supported.dedup();
        self.info.supported_pids = supported;
        self.log(
            LogDirection::Info,
            &format!(
                "protocol {}, {} PIDs supported",
                self.info.protocol,
                self.info.supported_pids.len()
            ),
        );
        Ok(&self.info)
    }

    /// Sends an OBD request (`mode` + `data`) and returns the positive answers,
    /// one per responding ECU.
    pub fn request(&mut self, mode: u8, data: &[u8]) -> Result<Vec<Vec<u8>>> {
        let mut cmd = format!("{mode:02X}");
        for b in data {
            cmd.push_str(&format!("{b:02X}"));
        }
        let lines = self.command(&cmd)?;
        check_errors(&lines)?;
        // Mode 02 echoes the PID but the frame number is part of the answer.
        let echo_len = if mode == 0x02 { 1 } else { data.len() };
        filter_responses(
            assemble_messages(&lines),
            mode,
            &data[..echo_len.min(data.len())],
        )
    }

    /// Reads one live PID (mode 01).
    pub fn read_pid(&mut self, pid: u8) -> Result<PidValue> {
        let def = PIDS
            .iter()
            .find(|d| d.pid == pid)
            .ok_or_else(|| ObdError::Parse(format!("PID {pid:02X} not in catalog")))?;
        let msgs = self.request(0x01, &[pid])?;
        let m = &msgs[0];
        def.decode_value(&m[2..])
    }

    /// Battery voltage measured by the adapter itself (`ATRV`).
    pub fn battery_voltage(&mut self) -> Result<f64> {
        let lines = self.command("ATRV")?;
        let text = lines.first().ok_or(ObdError::NoData)?;
        text.trim()
            .trim_end_matches(['V', 'v'])
            .trim()
            .replace(',', ".")
            .parse::<f64>()
            .map_err(|_| ObdError::Parse(format!("ATRV: {text}")))
    }

    fn read_dtc_mode(&mut self, mode: u8) -> Result<Vec<Dtc>> {
        match self.request(mode, &[]) {
            Ok(msgs) => {
                let can = self.info.is_can();
                let mut out = Vec::new();
                for m in msgs {
                    for d in decode_dtc_response(&m[1..], can) {
                        if !out.contains(&d) {
                            out.push(d);
                        }
                    }
                }
                Ok(out)
            }
            Err(ObdError::NoData) => Ok(Vec::new()),
            Err(e) => Err(e),
        }
    }

    /// Stored (confirmed) trouble codes, mode 03.
    pub fn read_stored_dtcs(&mut self) -> Result<Vec<Dtc>> {
        self.read_dtc_mode(0x03)
    }

    /// Pending trouble codes, mode 07.
    pub fn read_pending_dtcs(&mut self) -> Result<Vec<Dtc>> {
        self.read_dtc_mode(0x07)
    }

    /// Permanent trouble codes, mode 0A (not every car supports it).
    pub fn read_permanent_dtcs(&mut self) -> Result<Vec<Dtc>> {
        match self.read_dtc_mode(0x0A) {
            Err(ObdError::UnknownCommand) | Err(ObdError::NegativeResponse(_)) => Ok(Vec::new()),
            r => r,
        }
    }

    /// Clears trouble codes and turns the MIL off (mode 04).
    pub fn clear_dtcs(&mut self) -> Result<()> {
        let lines = self.command("04")?;
        check_errors(&lines)?;
        let msgs = assemble_messages(&lines);
        if let Some(m) = msgs.iter().find(|m| m.len() >= 3 && m[0] == 0x7F) {
            return Err(ObdError::NegativeResponse(m[2]));
        }
        Ok(())
    }

    /// Monitor status since DTCs cleared (mode 01 PID 01).
    pub fn read_readiness(&mut self) -> Result<Readiness> {
        let msgs = self.request(0x01, &[0x01])?;
        decode_readiness(&msgs[0][2..])
    }

    /// The DTC that caused the freeze frame (mode 02 PID 02).
    pub fn read_freeze_frame_dtc(&mut self) -> Result<Option<Dtc>> {
        let msgs = self.request(0x02, &[0x02, 0x00])?;
        // 42 02 00 HH LL
        let m = &msgs[0];
        if m.len() < 5 {
            return Ok(None);
        }
        Ok(decode_dtc_response(&m[3..5], false).into_iter().next())
    }

    /// Reads one PID from the freeze frame (mode 02, frame 0).
    pub fn read_freeze_frame_pid(&mut self, pid: u8) -> Result<PidValue> {
        let def = PIDS
            .iter()
            .find(|d| d.pid == pid)
            .ok_or_else(|| ObdError::Parse(format!("PID {pid:02X} not in catalog")))?;
        let msgs = self.request(0x02, &[pid, 0x00])?;
        // 42 PID FRAME A B ...
        def.decode_value(&msgs[0][3..])
    }

    /// VIN, calibration ID and ECU name (mode 09). Missing items stay `None`.
    pub fn read_vehicle_identity(&mut self) -> VehicleIdentity {
        let can = self.info.is_can();
        let read = |me: &mut Self, pid: u8| -> Option<String> {
            me.request(0x09, &[pid])
                .ok()
                .and_then(|m| assemble_mode09_string(&m, can))
        };
        VehicleIdentity {
            vin: read(self, 0x02),
            calibration_id: read(self, 0x04),
            ecu_name: read(self, 0x0A),
        }
    }

    pub fn transport_description(&self) -> String {
        self.transport.describe()
    }
}
