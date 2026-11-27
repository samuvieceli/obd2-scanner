//! Readiness monitors (mode 01 PID 01): the self-tests the ECU runs to verify
//! emission systems. Inspection stations check that they are "complete".

use serde::{Deserialize, Serialize};

use crate::{ObdError, Result};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MonitorState {
    Complete,
    Incomplete,
    NotSupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Monitor {
    /// Translation key, e.g. `catalyst`.
    pub key: String,
    pub state: MonitorState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Readiness {
    /// Check-engine light (MIL) on.
    pub mil_on: bool,
    /// Number of confirmed DTCs reported by the ECU.
    pub dtc_count: u8,
    /// `true` = diesel (compression ignition), `false` = gasoline/ethanol (spark).
    pub compression_ignition: bool,
    pub monitors: Vec<Monitor>,
}

fn state(available: bool, incomplete: bool) -> MonitorState {
    match (available, incomplete) {
        (false, _) => MonitorState::NotSupported,
        (true, true) => MonitorState::Incomplete,
        (true, false) => MonitorState::Complete,
    }
}

/// Decodes the 4 data bytes (A, B, C, D) of PID 01.
pub fn decode_readiness(d: &[u8]) -> Result<Readiness> {
    if d.len() < 4 {
        return Err(ObdError::Parse("PID 01 needs 4 bytes".into()));
    }
    let (a, b, c, dd) = (d[0], d[1], d[2], d[3]);
    let compression = b & 0x08 != 0;
    let mut monitors = vec![
        Monitor {
            key: "misfire".into(),
            state: state(b & 0x01 != 0, b & 0x10 != 0),
        },
        Monitor {
            key: "fuel_system".into(),
            state: state(b & 0x02 != 0, b & 0x20 != 0),
        },
        Monitor {
            key: "components".into(),
            state: state(b & 0x04 != 0, b & 0x40 != 0),
        },
    ];
    let names: [&str; 8] = if compression {
        [
            "nmhc_catalyst",
            "nox_scr",
            "",
            "boost_pressure",
            "",
            "exhaust_gas_sensor",
            "pm_filter",
            "egr_vvt",
        ]
    } else {
        [
            "catalyst",
            "heated_catalyst",
            "evap_system",
            "secondary_air",
            "ac_refrigerant",
            "o2_sensor",
            "o2_heater",
            "egr_vvt",
        ]
    };
    for (bit, name) in names.iter().enumerate() {
        if name.is_empty() {
            continue;
        }
        let mask = 1u8 << bit;
        monitors.push(Monitor {
            key: (*name).into(),
            state: state(c & mask != 0, dd & mask != 0),
        });
    }
    Ok(Readiness {
        mil_on: a & 0x80 != 0,
        dtc_count: a & 0x7F,
        compression_ignition: compression,
        monitors,
    })
}

/// Inverse of [`decode_readiness`] for the simulator.
pub fn encode_readiness(r: &Readiness) -> [u8; 4] {
    let mut out = [0u8; 4];
    out[0] = (r.dtc_count & 0x7F) | if r.mil_on { 0x80 } else { 0 };
    if r.compression_ignition {
        out[1] |= 0x08;
    }
    let names: [&str; 8] = if r.compression_ignition {
        [
            "nmhc_catalyst",
            "nox_scr",
            "",
            "boost_pressure",
            "",
            "exhaust_gas_sensor",
            "pm_filter",
            "egr_vvt",
        ]
    } else {
        [
            "catalyst",
            "heated_catalyst",
            "evap_system",
            "secondary_air",
            "ac_refrigerant",
            "o2_sensor",
            "o2_heater",
            "egr_vvt",
        ]
    };
    for m in &r.monitors {
        let (avail, inc) = match m.state {
            MonitorState::NotSupported => (false, false),
            MonitorState::Complete => (true, false),
            MonitorState::Incomplete => (true, true),
        };
        let (byte_a, byte_i, mask) = match m.key.as_str() {
            "misfire" => (1, 1, 0x01u8),
            "fuel_system" => (1, 1, 0x02),
            "components" => (1, 1, 0x04),
            k => match names.iter().position(|n| *n == k) {
                Some(bit) => (2, 3, 1u8 << bit),
                None => continue,
            },
        };
        if avail {
            out[byte_a] |= mask;
        }
        if inc {
            out[byte_i] |= if byte_i == 1 { mask << 4 } else { mask };
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_spark_engine() {
        // MIL on, 2 DTCs, misfire+fuel+components available, components incomplete,
        // catalyst + evap + O2 + O2 heater available, catalyst incomplete.
        let r = decode_readiness(&[0x82, 0x47, 0x65, 0x01]).unwrap();
        assert!(r.mil_on);
        assert_eq!(r.dtc_count, 2);
        assert!(!r.compression_ignition);
        let get = |k: &str| r.monitors.iter().find(|m| m.key == k).unwrap().state;
        assert_eq!(get("misfire"), MonitorState::Complete);
        assert_eq!(get("components"), MonitorState::Incomplete);
        assert_eq!(get("catalyst"), MonitorState::Incomplete);
        assert_eq!(get("evap_system"), MonitorState::Complete);
        assert_eq!(get("heated_catalyst"), MonitorState::NotSupported);
        assert_eq!(encode_readiness(&r), [0x82, 0x47, 0x65, 0x01]);
    }

    #[test]
    fn decodes_diesel() {
        let r = decode_readiness(&[0x00, 0x0F, 0xC0, 0x40]).unwrap();
        assert!(r.compression_ignition);
        assert!(r
            .monitors
            .iter()
            .any(|m| m.key == "pm_filter" && m.state == MonitorState::Incomplete));
    }
}
