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
    /// Ask up to 6 PIDs in one request on CAN cars (much faster). Turned off
    /// automatically for the session if the car or adapter does not cope.
    /// Idea from ELMduino (MIT).
    pub multi_pid: bool,
}

impl Default for ElmConfig {
    fn default() -> Self {
        Self {
            command_timeout_ms: 2_000,
            reset_timeout_ms: 5_000,
            search_timeout_ms: 15_000,
            protocol: "0".into(),
            elm_timeout_hex: String::new(),
            multi_pid: true,
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
    /// AT commands this adapter rejected (`?`) or ignored during setup.
    pub unsupported_at: Vec<String>,
    /// Version string typical of clones (v1.5, v2.1, v2.2 were never sold
    /// by ELM Electronics). Informational only: clones work for most tasks.
    pub likely_clone: bool,
}

/// Version strings used by clones: ELM Electronics never released 1.5,
/// 2.0 (as "v2.0" clones), 2.1 or 2.2 under those names.
pub fn looks_like_clone(version: &str) -> bool {
    let v = version.to_ascii_lowercase();
    ["v1.5", "v2.1", "v2.2"].iter().any(|k| v.contains(k))
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

    /// OBD request with one retry on transient failures common on clones:
    /// a lost answer (timeout), `STOPPED`, `BUFFER FULL` or a bus error.
    /// After a timeout a harmless `ATI` is sent first: any character
    /// interrupts an adapter still busy with the previous request and brings
    /// back the prompt. (A bare CR is avoided: an idle ELM327 would repeat
    /// the last command.)
    fn command_with_retry(&mut self, cmd: &str) -> Result<Vec<String>> {
        let attempt = |me: &mut Self| -> Result<Vec<String>> {
            let lines = me.command(cmd)?;
            check_errors(&lines)?;
            Ok(lines)
        };
        match attempt(self) {
            Err(e @ (ObdError::Timeout | ObdError::Bus(_))) => {
                self.log(LogDirection::Info, &format!("{cmd}: {e}, retrying once"));
                if matches!(e, ObdError::Timeout) {
                    let _ = self.raw_command("ATI", Duration::from_millis(500));
                }
                attempt(self)
            }
            other => other,
        }
    }

    /// AT command that tolerates unsupported (`?`) answers. Returns `true` if accepted.
    fn at_optional(&mut self, cmd: &str) -> Result<bool> {
        let accepted = match self.command(cmd) {
            Ok(lines) => !lines.iter().any(|l| l.trim() == "?"),
            Err(ObdError::Timeout) => {
                self.log(LogDirection::Info, &format!("{cmd}: no answer, ignoring"));
                false
            }
            Err(e) => return Err(e),
        };
        if !accepted && !self.info.unsupported_at.iter().any(|c| c == cmd) {
            self.info.unsupported_at.push(cmd.to_string());
        }
        Ok(accepted)
    }

    /// Full setup: [`Self::setup_adapter`] then [`Self::connect_vehicle`].
    pub fn initialize(&mut self) -> Result<&AdapterInfo> {
        self.setup_adapter()?;
        self.connect_vehicle()
    }

    /// Step 1: reset and configure the adapter. Does not need the car.
    pub fn setup_adapter(&mut self) -> Result<()> {
        self.log(LogDirection::Info, "initializing adapter");
        // Wake-up: some adapters ignore the first command after opening the
        // port. `ATI` is harmless; a bare CR would repeat the last command
        // the adapter received (possibly from another program).
        let _ = self.raw_command("ATI", Duration::from_millis(300));
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
        self.info.likely_clone = looks_like_clone(&self.info.version);
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
        let first = match self.first_contact(self.config.search_timeout_ms) {
            Ok(f) => f,
            Err(e) if self.config.protocol == "0" && Self::worth_retrying(&e) => {
                self.try_protocols_one_by_one().map_err(|_| e)?
            }
            Err(e) => return Err(e),
        };
        let mut supported = Vec::new();
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

    /// First OBD request (`0100`): the adapter searches the protocol, which can
    /// take seconds.
    fn first_contact(&mut self, timeout_ms: u64) -> Result<Vec<Vec<u8>>> {
        let raw = self.raw_command("0100", Duration::from_millis(timeout_ms))?;
        let lines = clean_lines(&raw, "0100");
        check_errors(&lines)?;
        filter_responses(assemble_messages(&lines), 0x01, &[0x00])
    }

    fn worth_retrying(e: &ObdError) -> bool {
        matches!(
            e,
            ObdError::UnableToConnect | ObdError::NoData | ObdError::Bus(_) | ObdError::Timeout
        )
    }

    /// Plan B when automatic search fails (some adapter/car combinations do not
    /// work in auto mode): try each protocol with `ATTP`, most common first.
    /// Idea from python-OBD / pyOBD (GPL-2.0-or-later).
    fn try_protocols_one_by_one(&mut self) -> Result<Vec<Vec<u8>>> {
        const ORDER: [&str; 9] = ["6", "8", "1", "7", "9", "2", "3", "4", "5"];
        let per_try = (self.config.command_timeout_ms * 3).max(3_000);
        let mut last = ObdError::UnableToConnect;
        for p in ORDER {
            self.log(
                LogDirection::Info,
                &format!("automatic search failed, trying protocol {p}"),
            );
            if !self.at_optional(&format!("ATTP{p}"))? {
                continue;
            }
            match self.first_contact(per_try) {
                Ok(f) => return Ok(f),
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    /// Sends an OBD request (`mode` + `data`) and returns the positive answers,
    /// one per responding ECU.
    pub fn request(&mut self, mode: u8, data: &[u8]) -> Result<Vec<Vec<u8>>> {
        let mut cmd = format!("{mode:02X}");
        for b in data {
            cmd.push_str(&format!("{b:02X}"));
        }
        let lines = self.command_with_retry(&cmd)?;
        // Mode 02 echoes the PID but the frame number is part of the answer.
        let echo_len = if mode == 0x02 { 1 } else { data.len() };
        filter_responses(
            assemble_messages(&lines),
            mode,
            &data[..echo_len.min(data.len())],
        )
    }

    /// Reads several mode 01 PIDs in one request (CAN allows up to 6).
    /// Returns `(key, value)` for every key of every PID answered; PIDs
    /// missing from the answer are simply absent.
    pub fn read_pids_multi(&mut self, pids: &[u8]) -> Result<Vec<(String, f64)>> {
        let pids = &pids[..pids.len().min(6)];
        let mut cmd = String::from("01");
        for p in pids {
            cmd.push_str(&format!("{p:02X}"));
        }
        let lines = self.command_with_retry(&cmd)?;
        let mut out: Vec<(String, f64)> = Vec::new();
        let mut seen: Vec<u8> = Vec::new();
        for m in assemble_messages(&lines) {
            if m.first() != Some(&0x41) {
                continue;
            }
            let mut i = 1;
            while i < m.len() {
                let pid = m[i];
                let Some(first) = PIDS.iter().find(|d| d.pid == pid) else {
                    break;
                };
                if !pids.contains(&pid) || i + 1 + first.bytes > m.len() {
                    break;
                }
                if !seen.contains(&pid) {
                    seen.push(pid);
                    let data = &m[i + 1..i + 1 + first.bytes];
                    for def in crate::pid::defs_for(pid) {
                        out.push((def.key.to_string(), def.decode_value(data)?.value));
                    }
                }
                i += 1 + first.bytes;
            }
        }
        if out.is_empty() {
            return Err(ObdError::NoData);
        }
        Ok(out)
    }

    /// Reads one PID and returns every key it carries.
    pub fn read_pid_values(&mut self, pid: u8) -> Result<Vec<(String, f64)>> {
        let msgs = self.request(0x01, &[pid])?;
        let data = &msgs[0][2..];
        let mut out = Vec::new();
        for def in crate::pid::defs_for(pid) {
            out.push((def.key.to_string(), def.decode_value(data)?.value));
        }
        if out.is_empty() {
            return Err(ObdError::Parse(format!("PID {pid:02X} not in catalog")));
        }
        Ok(out)
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

    /// Mode 06: on-board test results (CAN vehicles only). Returns every
    /// record of every supported monitor; monitors that fail to answer are
    /// skipped.
    pub fn read_mode06(&mut self) -> Result<Vec<crate::mode06::TestResult>> {
        if !self.info.is_can() {
            return Err(ObdError::Parse(
                "mode 06 is only supported on CAN vehicles".into(),
            ));
        }
        let mut mids = Vec::new();
        let mut base = 0u8;
        loop {
            let msgs = self.request(0x06, &[base])?;
            let mut more = false;
            for m in &msgs {
                if m.len() < 6 {
                    continue;
                }
                for mid in crate::pid::decode_supported(base, &m[2..6]) {
                    if mid.is_multiple_of(0x20) {
                        more |= mid == base.wrapping_add(0x20);
                    } else if !mids.contains(&mid) {
                        mids.push(mid);
                    }
                }
            }
            if !more || base >= 0xE0 {
                break;
            }
            base += 0x20;
        }
        mids.sort_unstable();
        let mut out = Vec::new();
        for mid in mids {
            match self.request(0x06, &[mid]) {
                Ok(msgs) => {
                    for m in msgs {
                        out.extend(crate::mode06::decode_records(&m[1..]));
                    }
                }
                Err(ObdError::NoData) | Err(ObdError::NegativeResponse(_)) => continue,
                Err(e) => return Err(e),
            }
        }
        Ok(out)
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
