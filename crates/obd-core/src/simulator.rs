//! Built-in virtual car + ELM327 ("demo mode").
//!
//! The simulator is a [`Transport`]: it receives the same text commands a real
//! adapter would and answers with the same text, so demo mode exercises the
//! whole stack (protocol, parsing, decoding, UI). It models a warm-up, a
//! repeating 60 s drive cycle, a mildly lean engine, a misfire on cylinder 1
//! and a tired catalytic converter, so every screen has something to show.
//!
//! With `quirky = true` it imitates a cheap clone: ignores `ATE0`, rejects
//! some AT commands, prints `SEARCHING...` and sends stray NUL bytes.
//!
//! Failures of cheap clones can be triggered on purpose with commands a
//! real adapter does not have (they answer `?` there), to try the recovery
//! and reconnection features:
//!
//! | Command | Imitates | Fixed by |
//! | --- | --- | --- |
//! | `ATSIMHANG` | frozen OBD side: car requests get no answer | `ATZ` / `ATWS` |
//! | `ATSIMRESET` | reboot after a voltage dip (banner, settings lost) | setup again |
//! | `ATSIMFREEZE` | adapter fully frozen, not even `ATI` answers | reopening (power cycle) |
//! | `ATSIMDROP` | Bluetooth out of range: the port fails | reopening |

use std::collections::VecDeque;
use std::f64::consts::PI;
use std::time::{Duration, Instant};

use crate::dtc::encode_dtc;
use crate::pid::encode_supported;
use crate::readiness::{encode_readiness, Monitor, MonitorState, Readiness};
use crate::transport::Transport;
use crate::Result;

/// Fictitious VIN with a valid check digit (Volkswagen do Brasil WMI).
pub const DEMO_VIN: &str = "9BWAB45UXRT000123";

#[derive(Debug, Clone, Default)]
pub struct SimulatorOptions {
    /// Artificial answer delay, to feel like a real adapter.
    pub latency_ms: u64,
    /// Imitate a quirky clone adapter.
    pub quirky: bool,
    /// Speed-up factor for the virtual clock (1.0 = real time).
    pub time_scale: f64,
}

/// Failure being imitated (see the module documentation).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fault {
    None,
    Hang,
    Reset,
    Freeze,
    Drop,
}

/// Physical values of the virtual engine at one instant.
#[derive(Debug, Clone, Copy, Default)]
pub struct EngineState {
    pub rpm: f64,
    pub speed: f64,
    pub load: f64,
    pub throttle: f64,
    pub coolant: f64,
    pub intake_temp: f64,
    pub maf: f64,
    pub map: f64,
    pub timing: f64,
    pub stft: f64,
    pub ltft: f64,
    pub o2_up: f64,
    pub o2_down: f64,
    pub fuel_level: f64,
    pub catalyst_temp: f64,
    pub module_voltage: f64,
    pub oil_temp: f64,
    pub run_time: f64,
}

/// Engine model as a pure function of time (seconds since start).
pub fn engine_at(t: f64) -> EngineState {
    let noise = |k: f64| (t * k).sin() * 0.5 + (t * k * 2.7).sin() * 0.5;
    let cycle = t % 60.0;
    // speed profile: idle, accelerate, cruise, brake, idle
    let (speed, phase) = if cycle < 10.0 {
        (0.0, 0)
    } else if cycle < 25.0 {
        (80.0 * (cycle - 10.0) / 15.0, 1)
    } else if cycle < 40.0 {
        (80.0 + noise(0.7) * 2.0, 2)
    } else if cycle < 50.0 {
        (80.0 * (50.0 - cycle) / 10.0, 3)
    } else {
        (0.0, 0)
    };
    let warm = 1.0 - (-t / 60.0).exp();
    let (load, throttle, timing) = match phase {
        1 => (68.0 + noise(1.3) * 5.0, 42.0 + noise(1.1) * 6.0, 18.0),
        2 => (34.0 + noise(0.9) * 3.0, 19.0 + noise(0.8) * 2.0, 31.0),
        3 => (9.0, 11.0, 24.0),
        _ => (22.0 + noise(2.0) * 1.5, 12.5, 10.0 + noise(1.7)),
    };
    let rpm = match phase {
        0 => 820.0 + noise(3.1) * 25.0 + (1.0 - warm) * 350.0,
        1 => 1500.0 + (speed % 27.0) * 60.0,
        2 => speed * 30.0,
        _ => (900.0 + speed * 25.0).max(820.0),
    };
    let maf = rpm * load / 100.0 * 0.0166 + 0.4;
    let coolant = 25.0 + 65.0 * warm + noise(0.05) * 1.5 * warm;
    let stft = 3.0 * (t * 2.0 * PI / 3.0).sin() + noise(4.0);
    let o2 = (t * 2.0 * PI * 0.9).sin();
    EngineState {
        rpm: rpm.max(0.0),
        speed: speed.max(0.0),
        load,
        throttle,
        coolant,
        intake_temp: 32.0 + noise(0.1) * 2.0,
        maf,
        map: 30.0 + load * 0.7,
        timing,
        stft,
        ltft: 6.3,
        o2_up: 0.45 + 0.38 * o2.signum() * o2.abs().sqrt(),
        // P0420: downstream sensor copies the upstream one (bad catalyst).
        o2_down: 0.45 + 0.25 * o2,
        fuel_level: (62.0 - t * 0.01).max(5.0),
        catalyst_temp: 280.0 + 370.0 * warm + load * 2.0,
        module_voltage: 14.1 + noise(0.6) * 0.05,
        oil_temp: 25.0 + 70.0 * (1.0 - (-t / 120.0).exp()),
        run_time: t,
    }
}

pub struct Simulator {
    opts: SimulatorOptions,
    start: Instant,
    echo: bool,
    spaces: bool,
    linefeeds: bool,
    searched: bool,
    stored: Vec<&'static str>,
    pending: Vec<&'static str>,
    permanent: Vec<&'static str>,
    freeze: Option<EngineState>,
    distance_since_clear: u16,
    cleared: bool,
    input: Vec<u8>,
    out: VecDeque<u8>,
    ready_at: Instant,
    fault: Fault,
}

const SUPPORTED: &[u8] = &[
    0x01, 0x04, 0x05, 0x06, 0x07, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x14, 0x15, 0x1F, 0x20,
    0x21, 0x2F, 0x30, 0x31, 0x33, 0x3C, 0x40, 0x42, 0x44, 0x46, 0x49, 0x4E, 0x52, 0x5C, 0x5E, 0x60,
    0x80, 0xA0, 0xA6,
];

impl Simulator {
    pub fn new(mut opts: SimulatorOptions) -> Self {
        if opts.time_scale <= 0.0 {
            opts.time_scale = 1.0;
        }
        Self {
            opts,
            start: Instant::now(),
            echo: true,
            spaces: true,
            linefeeds: true,
            searched: false,
            stored: vec!["P0301", "P0420"],
            pending: vec!["P0171"],
            permanent: vec!["P0420"],
            freeze: Some(EngineState {
                rpm: 2350.0,
                speed: 64.0,
                load: 72.5,
                throttle: 38.0,
                coolant: 88.0,
                intake_temp: 34.0,
                stft: 7.8,
                ltft: 6.3,
                ..Default::default()
            }),
            distance_since_clear: 1543,
            cleared: false,
            input: Vec::new(),
            out: VecDeque::new(),
            ready_at: Instant::now(),
            fault: Fault::None,
        }
    }

    fn now(&self) -> f64 {
        self.start.elapsed().as_secs_f64() * self.opts.time_scale
    }

    fn hex(&self, bytes: &[u8]) -> String {
        let sep = if self.spaces { " " } else { "" };
        bytes
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect::<Vec<_>>()
            .join(sep)
    }

    /// Formats a payload like an ELM327 on CAN with headers off.
    fn can_lines(&self, payload: &[u8]) -> Vec<String> {
        if payload.len() <= 7 {
            return vec![self.hex(payload)];
        }
        let mut lines = vec![format!("{:03X}", payload.len())];
        let mut idx = 0u8;
        let mut rest = payload;
        let first = rest.len().min(6);
        lines.push(format!("{idx}: {}", self.hex(&rest[..first])));
        rest = &rest[first..];
        while !rest.is_empty() {
            idx = (idx + 1) % 16;
            let n = rest.len().min(7);
            let mut frame = rest[..n].to_vec();
            frame.resize(7, 0x00);
            lines.push(format!("{idx:X}: {}", self.hex(&frame)));
            rest = &rest[n..];
        }
        lines
    }

    fn readiness(&self) -> Readiness {
        let inc = if self.cleared {
            MonitorState::Incomplete
        } else {
            MonitorState::Complete
        };
        let m = |k: &str, s| Monitor {
            key: k.into(),
            state: s,
        };
        Readiness {
            mil_on: !self.stored.is_empty(),
            dtc_count: self.stored.len() as u8,
            compression_ignition: false,
            monitors: vec![
                m("misfire", MonitorState::Complete),
                m("fuel_system", MonitorState::Complete),
                m("components", MonitorState::Complete),
                m("catalyst", MonitorState::Incomplete),
                m("heated_catalyst", MonitorState::NotSupported),
                m("evap_system", inc),
                m("secondary_air", MonitorState::NotSupported),
                m("ac_refrigerant", MonitorState::NotSupported),
                m("o2_sensor", MonitorState::Complete),
                m("o2_heater", inc),
                m("egr_vvt", MonitorState::NotSupported),
            ],
        }
    }

    /// Mode 06 test results: oxygen sensor, a catalyst outside its limit
    /// (matches P0420), EVAP and misfire counts for cylinder 1 (P0301).
    fn mode06(&self, mid: u8) -> Option<Vec<u8>> {
        use crate::mode06::encode_record as r;
        const MIDS: &[u8] = &[0x01, 0x02, 0x21, 0x3B, 0x41, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5];
        if mid.is_multiple_of(0x20) {
            return (mid <= 0xA0).then(|| {
                let mut list: Vec<u8> = MIDS.to_vec();
                list.extend([0x20, 0x40, 0x60, 0x80, 0xA0]);
                [&[0x46, mid][..], &encode_supported(mid, &list)].concat()
            });
        }
        let misfires = if self.cleared { 0 } else { 41 };
        let records: Vec<[u8; 9]> = match mid {
            0x01 => vec![
                r(0x01, 0x01, 0x0A, 3690, 3280, 4100),
                r(0x01, 0x02, 0x0A, 3690, 3280, 4100),
                r(0x01, 0x05, 0x10, 62, 0, 150),
                r(0x01, 0x06, 0x10, 58, 0, 150),
            ],
            0x02 => vec![
                r(0x02, 0x07, 0x0A, 3100, 0, 3690),
                r(0x02, 0x08, 0x0A, 6200, 5330, 8200),
            ],
            // Catalyst efficiency ratio: 0.82 with a limit of 0.75 → fails.
            0x21 => vec![r(
                0x21,
                0x80,
                0x20,
                if self.cleared { 150 } else { 210 },
                0,
                192,
            )],
            0x3B => vec![r(0x3B, 0x80, 0xFE, 120, 0, 600)],
            0x41 => vec![r(0x41, 0x81, 0x10, 22_000 / 1000, 0, 60)],
            0xA1 => vec![
                r(0xA1, 0x0B, 0x24, misfires / 10, 0, 65_535),
                r(0xA1, 0x0C, 0x24, misfires, 0, 65_535),
            ],
            0xA2 => vec![
                r(0xA2, 0x0B, 0x24, misfires / 10, 0, 65_535),
                r(0xA2, 0x0C, 0x24, misfires, 0, 30),
            ],
            0xA3..=0xA5 => vec![
                r(mid, 0x0B, 0x24, 0, 0, 65_535),
                r(mid, 0x0C, 0x24, 0, 0, 30),
            ],
            _ => return None,
        };
        let mut out = vec![0x46];
        for rec in records {
            out.extend(rec);
        }
        Some(out)
    }

    /// Raw data bytes of a mode 01 PID for the given engine state.
    fn pid_bytes(&self, pid: u8, e: &EngineState) -> Option<Vec<u8>> {
        let u8c = |v: f64| v.round().clamp(0.0, 255.0) as u8;
        let u16c = |v: f64| {
            let v = v.round().clamp(0.0, 65535.0) as u16;
            vec![(v >> 8) as u8, v as u8]
        };
        let pct = |v: f64| u8c(v * 255.0 / 100.0);
        let trim = |v: f64| u8c((v + 100.0) * 128.0 / 100.0);
        Some(match pid {
            0x00 | 0x20 | 0x40 | 0x60 | 0x80 | 0xA0 => encode_supported(pid, SUPPORTED).to_vec(),
            0x01 => encode_readiness(&self.readiness()).to_vec(),
            0x04 => vec![pct(e.load)],
            0x05 => vec![u8c(e.coolant + 40.0)],
            0x06 => vec![trim(e.stft)],
            0x07 => vec![trim(e.ltft)],
            0x0B => vec![u8c(e.map)],
            0x0C => u16c(e.rpm * 4.0),
            0x0D => vec![u8c(e.speed)],
            0x0E => vec![u8c((e.timing + 64.0) * 2.0)],
            0x0F => vec![u8c(e.intake_temp + 40.0)],
            0x10 => u16c(e.maf * 100.0),
            0x11 => vec![pct(e.throttle)],
            0x14 => vec![u8c(e.o2_up * 200.0), trim(e.stft)],
            0x15 => vec![u8c(e.o2_down * 200.0), 0xFF],
            0x1F => u16c(e.run_time),
            0x21 => u16c(if self.stored.is_empty() { 0.0 } else { 128.0 }),
            0x2F => vec![pct(e.fuel_level)],
            0x30 => vec![if self.cleared { 0 } else { 37 }],
            0x31 => u16c(self.distance_since_clear as f64),
            0x33 => vec![101],
            0x3C => u16c((e.catalyst_temp + 40.0) * 10.0),
            0x42 => u16c(e.module_voltage * 1000.0),
            0x44 => u16c(1.0 * 65536.0 / 2.0),
            0x46 => vec![u8c(27.0 + 40.0)],
            0x49 => vec![pct((e.throttle - 10.0).max(0.0) * 1.6 + 15.0)],
            0x52 => vec![pct(27.0)],
            0x5C => vec![u8c(e.oil_temp + 40.0)],
            0x5E => u16c(e.maf * 0.33 * 20.0),
            0x4E => u16c(if self.cleared {
                e.run_time / 60.0
            } else {
                4_620.0
            }),
            0xA6 => {
                // 48,213.0 km plus the distance driven in the drive cycle model.
                let km = 48_213.0 + (e.run_time / 60.0) * 0.6;
                ((km * 10.0) as u32).to_be_bytes().to_vec()
            }
            _ => return None,
        })
    }

    fn handle(&mut self, raw: &str) -> Vec<String> {
        let cmd: String = raw
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>()
            .to_ascii_uppercase();
        if cmd.is_empty() {
            return vec![];
        }
        if let Some(at) = cmd.strip_prefix("AT") {
            return self.handle_at(at);
        }
        let Some(bytes) = crate::response::parse_hex_line(&cmd) else {
            return vec!["?".into()];
        };
        let mut prefix = Vec::new();
        if !self.searched {
            self.searched = true;
            if self.opts.quirky {
                prefix.push("SEARCHING...".to_string());
            }
        }
        let body = self.handle_obd(&bytes);
        prefix.extend(body);
        prefix
    }

    fn handle_at(&mut self, at: &str) -> Vec<String> {
        let ok = || vec!["OK".to_string()];
        let quirky = self.opts.quirky;
        match at {
            "SIMHANG" | "SIMRESET" | "SIMFREEZE" | "SIMDROP" => {
                self.fault = match at {
                    "SIMHANG" => Fault::Hang,
                    "SIMRESET" => Fault::Reset,
                    "SIMFREEZE" => Fault::Freeze,
                    _ => Fault::Drop,
                };
                ok()
            }
            "Z" | "WS" => {
                if self.fault == Fault::Hang {
                    self.fault = Fault::None;
                }
                self.echo = true;
                self.spaces = true;
                self.linefeeds = true;
                self.searched = false;
                vec![String::new(), "ELM327 v1.5".into()]
            }
            "I" => vec!["ELM327 v1.5".into()],
            "@1" => vec!["OBDII to RS232 Interpreter".into()],
            "E0" => {
                if !quirky {
                    self.echo = false;
                }
                ok()
            }
            "E1" => {
                self.echo = true;
                ok()
            }
            "S0" => {
                if !quirky {
                    self.spaces = false;
                }
                ok()
            }
            "S1" => {
                self.spaces = true;
                ok()
            }
            "L0" => {
                self.linefeeds = false;
                if quirky {
                    vec![]
                } else {
                    ok()
                }
            }
            "L1" => {
                self.linefeeds = true;
                ok()
            }
            "AT1" | "AT2" | "DP" if quirky => vec!["?".into()],
            "DPN" => vec!["A6".into()],
            "DP" => vec!["AUTO, ISO 15765-4 (CAN 11/500)".into()],
            "RV" => {
                let e = engine_at(self.now());
                vec![format!("{:.1}V", e.module_voltage + 0.1)]
            }
            a if a.starts_with("SP")
                || a.starts_with("TP")
                || a.starts_with("ST")
                || a.starts_with("AT")
                || a.starts_with('H')
                || a.starts_with('D')
                || a.starts_with("CAF")
                || a.starts_with("PC") =>
            {
                ok()
            }
            _ => vec!["?".into()],
        }
    }

    fn handle_obd(&mut self, req: &[u8]) -> Vec<String> {
        let e = engine_at(self.now());
        let mode = req[0];
        let resp: Option<Vec<u8>> = match mode {
            // Up to 6 PIDs per request, answered in one (multi-frame) message.
            0x01 if req.len() >= 2 => {
                let mut out = vec![0x41];
                for &pid in req[1..].iter().take(6) {
                    if let Some(d) = self.pid_bytes(pid, &e) {
                        out.push(pid);
                        out.extend(d);
                    }
                }
                (out.len() > 1).then_some(out)
            }
            0x02 if req.len() >= 2 => {
                let pid = req[1];
                match (pid, self.freeze) {
                    (0x02, Some(_)) => {
                        let [a, b] =
                            encode_dtc(self.stored.first().copied().unwrap_or("P0301")).unwrap();
                        Some(vec![0x42, 0x02, 0x00, a, b])
                    }
                    (0x02, None) => Some(vec![0x42, 0x02, 0x00, 0x00, 0x00]),
                    (p, Some(ff)) if p != 0x01 && p != 0x00 && p != 0x20 => self
                        .pid_bytes(p, &ff)
                        .map(|d| [&[0x42, p, 0x00], &d[..]].concat()),
                    (0x00, Some(_)) => {
                        let pids = [0x02, 0x04, 0x05, 0x06, 0x07, 0x0C, 0x0D, 0x0F, 0x11];
                        Some([&[0x42, 0x00, 0x00][..], &encode_supported(0, &pids)].concat())
                    }
                    _ => None,
                }
            }
            0x03 | 0x07 | 0x0A => {
                let list = match mode {
                    0x03 => &self.stored,
                    0x07 => &self.pending,
                    _ => &self.permanent,
                };
                let mut out = vec![mode + 0x40, list.len() as u8];
                for c in list {
                    out.extend(encode_dtc(c).unwrap());
                }
                Some(out)
            }
            0x04 => {
                self.stored.clear();
                self.pending.clear();
                self.freeze = None;
                self.distance_since_clear = 0;
                self.cleared = true;
                Some(vec![0x44])
            }
            0x06 if req.len() >= 2 => self.mode06(req[1]),
            0x09 if req.len() >= 2 => match req[1] {
                0x00 => {
                    Some([&[0x49, 0x00][..], &encode_supported(0, &[0x02, 0x04, 0x0A])].concat())
                }
                0x02 => Some([&[0x49, 0x02, 0x01][..], DEMO_VIN.as_bytes()].concat()),
                0x04 => {
                    let mut id = b"SIMCAL-0001".to_vec();
                    id.resize(16, 0);
                    Some([&[0x49, 0x04, 0x01][..], &id].concat())
                }
                0x0A => {
                    let mut name = b"ECM-EngineControl".to_vec();
                    name.resize(20, 0);
                    Some([&[0x49, 0x0A, 0x01][..], &name].concat())
                }
                _ => None,
            },
            _ => None,
        };
        match resp {
            Some(bytes) => self.can_lines(&bytes),
            None => vec!["NO DATA".into()],
        }
    }
}

impl Simulator {
    /// Applies an active fault to a command. Returns `true` when the command
    /// must get no answer at all.
    fn swallowed_by_fault(&mut self, cmd: &str) -> bool {
        let is_obd = !cmd.trim().to_ascii_uppercase().starts_with("AT");
        match self.fault {
            Fault::Freeze => true,
            Fault::Hang => is_obd,
            Fault::Reset if is_obd => {
                // Boot banner instead of the answer, settings back to defaults.
                self.fault = Fault::None;
                self.echo = true;
                self.spaces = true;
                self.linefeeds = true;
                self.searched = false;
                self.out.extend("\r\rELM327 v1.5\r\r>".bytes());
                true
            }
            _ => false,
        }
    }
}

fn link_dropped() -> crate::ObdError {
    crate::ObdError::Io(std::io::Error::new(
        std::io::ErrorKind::ConnectionAborted,
        "demo: Bluetooth connection lost",
    ))
}

impl Transport for Simulator {
    fn write_all(&mut self, data: &[u8]) -> Result<()> {
        if self.fault == Fault::Drop {
            return Err(link_dropped());
        }
        self.input.extend_from_slice(data);
        while let Some(pos) = self.input.iter().position(|&b| b == b'\r') {
            let line: Vec<u8> = self.input.drain(..=pos).collect();
            let cmd = String::from_utf8_lossy(&line[..line.len() - 1]).to_string();
            if self.swallowed_by_fault(&cmd) {
                self.ready_at = Instant::now() + Duration::from_millis(self.opts.latency_ms);
                continue;
            }
            let eol = if self.linefeeds { "\r\n" } else { "\r" };
            let mut text = String::new();
            if self.echo {
                text.push_str(&cmd);
                text.push_str(eol);
            }
            if self.opts.quirky {
                text.push('\0');
            }
            for l in self.handle(&cmd) {
                text.push_str(&l);
                text.push_str(eol);
            }
            text.push_str(eol);
            text.push('>');
            self.out.extend(text.bytes());
            self.ready_at = Instant::now() + Duration::from_millis(self.opts.latency_ms);
        }
        Ok(())
    }

    fn read(&mut self, buf: &mut [u8], timeout: Duration) -> Result<usize> {
        // The "OK" to ATSIMDROP still arrives; the link fails after it.
        if self.fault == Fault::Drop && self.out.is_empty() {
            return Err(link_dropped());
        }
        let now = Instant::now();
        if self.out.is_empty() {
            std::thread::sleep(timeout.min(Duration::from_millis(50)));
            return Ok(0);
        }
        if now < self.ready_at {
            let wait = (self.ready_at - now).min(timeout);
            std::thread::sleep(wait);
            if Instant::now() < self.ready_at {
                return Ok(0);
            }
        }
        let n = buf.len().min(self.out.len());
        for (i, b) in self.out.drain(..n).enumerate() {
            buf[i] = b;
        }
        Ok(n)
    }

    fn clear_input(&mut self) -> Result<()> {
        if self.fault == Fault::Drop {
            return Err(link_dropped());
        }
        self.out.clear();
        Ok(())
    }

    fn describe(&self) -> String {
        if self.opts.quirky {
            "Demo (clone)".into()
        } else {
            "Demo".into()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vin::check_digit;

    #[test]
    fn demo_vin_has_valid_check_digit() {
        assert_eq!(check_digit(DEMO_VIN), DEMO_VIN.chars().nth(8));
    }

    #[test]
    fn engine_warms_up() {
        assert!(engine_at(0.0).coolant < 30.0);
        assert!(engine_at(300.0).coolant > 85.0);
        assert!(engine_at(30.0).speed > 70.0);
    }
}
