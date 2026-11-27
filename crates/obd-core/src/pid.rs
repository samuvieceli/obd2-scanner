//! Catalog of mode 01 PIDs (live data) with SAE J1979 formulas.
//!
//! Names and explanations are not here: the UI translates them from the `key`
//! (see `src/i18n/*.json`). Formulas follow SAE J1979 / ISO 15031-5 and were
//! cross-checked with the open-source project provrb/obdium (GPL-3.0).

use serde::{Deserialize, Serialize};

use crate::{ObdError, Result};

/// Grouping used by the UI.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PidCategory {
    Engine,
    Fuel,
    Air,
    Temperature,
    Emissions,
    Electrical,
    Vehicle,
}

/// Definition of one live parameter.
#[derive(Debug, Clone)]
pub struct PidDef {
    pub pid: u8,
    /// Stable identifier, also used as translation key and CSV column.
    pub key: &'static str,
    pub unit: &'static str,
    /// Typical range, used to scale gauges and charts.
    pub min: f64,
    pub max: f64,
    /// Data bytes needed by the formula.
    pub bytes: usize,
    pub category: PidCategory,
    pub formula: fn(&[u8]) -> f64,
}

/// Serializable description of a PID for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PidMeta {
    pub pid: u8,
    pub key: String,
    pub unit: String,
    pub min: f64,
    pub max: f64,
    pub category: PidCategory,
}

/// A decoded reading.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct PidValue {
    pub pid: u8,
    pub value: f64,
}

impl PidDef {
    pub fn decode_value(&self, data: &[u8]) -> Result<PidValue> {
        if data.len() < self.bytes {
            return Err(ObdError::Parse(format!(
                "PID {:02X}: expected {} bytes, got {}",
                self.pid,
                self.bytes,
                data.len()
            )));
        }
        let value = (self.formula)(data);
        Ok(PidValue {
            pid: self.pid,
            value: (value * 1000.0).round() / 1000.0,
        })
    }

    pub fn meta(&self) -> PidMeta {
        PidMeta {
            pid: self.pid,
            key: self.key.into(),
            unit: self.unit.into(),
            min: self.min,
            max: self.max,
            category: self.category,
        }
    }
}

fn a(d: &[u8]) -> f64 {
    d[0] as f64
}
fn ab(d: &[u8]) -> f64 {
    d[0] as f64 * 256.0 + d[1] as f64
}
fn percent(d: &[u8]) -> f64 {
    a(d) * 100.0 / 255.0
}
fn temp(d: &[u8]) -> f64 {
    a(d) - 40.0
}
fn trim(d: &[u8]) -> f64 {
    a(d) * 100.0 / 128.0 - 100.0
}
fn o2_voltage(d: &[u8]) -> f64 {
    a(d) / 200.0
}

use PidCategory::*;

macro_rules! pid {
    ($pid:expr, $key:expr, $unit:expr, $min:expr, $max:expr, $bytes:expr, $cat:expr, $f:expr) => {
        PidDef {
            pid: $pid,
            key: $key,
            unit: $unit,
            min: $min,
            max: $max,
            bytes: $bytes,
            category: $cat,
            formula: $f,
        }
    };
}

/// Live-data PIDs supported by the app.
pub static PIDS: &[PidDef] = &[
    pid!(0x04, "engine_load", "%", 0.0, 100.0, 1, Engine, percent),
    pid!(
        0x05,
        "coolant_temp",
        "°C",
        -40.0,
        130.0,
        1,
        Temperature,
        temp
    ),
    pid!(0x06, "stft_b1", "%", -25.0, 25.0, 1, Fuel, trim),
    pid!(0x07, "ltft_b1", "%", -25.0, 25.0, 1, Fuel, trim),
    pid!(0x08, "stft_b2", "%", -25.0, 25.0, 1, Fuel, trim),
    pid!(0x09, "ltft_b2", "%", -25.0, 25.0, 1, Fuel, trim),
    pid!(0x0A, "fuel_pressure", "kPa", 0.0, 765.0, 1, Fuel, |d| a(d)
        * 3.0),
    pid!(0x0B, "intake_map", "kPa", 0.0, 255.0, 1, Air, a),
    pid!(0x0C, "rpm", "rpm", 0.0, 8000.0, 2, Engine, |d| ab(d) / 4.0),
    pid!(0x0D, "speed", "km/h", 0.0, 220.0, 1, Vehicle, a),
    pid!(0x0E, "timing_advance", "°", -64.0, 63.5, 1, Engine, |d| a(
        d
    )
        / 2.0
        - 64.0),
    pid!(
        0x0F,
        "intake_temp",
        "°C",
        -40.0,
        100.0,
        1,
        Temperature,
        temp
    ),
    pid!(0x10, "maf", "g/s", 0.0, 300.0, 2, Air, |d| ab(d) / 100.0),
    pid!(0x11, "throttle", "%", 0.0, 100.0, 1, Engine, percent),
    pid!(0x14, "o2_b1s1", "V", 0.0, 1.275, 2, Emissions, o2_voltage),
    pid!(0x15, "o2_b1s2", "V", 0.0, 1.275, 2, Emissions, o2_voltage),
    pid!(0x16, "o2_b1s3", "V", 0.0, 1.275, 2, Emissions, o2_voltage),
    pid!(0x17, "o2_b1s4", "V", 0.0, 1.275, 2, Emissions, o2_voltage),
    pid!(0x18, "o2_b2s1", "V", 0.0, 1.275, 2, Emissions, o2_voltage),
    pid!(0x19, "o2_b2s2", "V", 0.0, 1.275, 2, Emissions, o2_voltage),
    pid!(0x1F, "run_time", "s", 0.0, 65535.0, 2, Vehicle, ab),
    pid!(0x21, "distance_mil", "km", 0.0, 65535.0, 2, Vehicle, ab),
    pid!(
        0x22,
        "fuel_rail_pressure_rel",
        "kPa",
        0.0,
        5177.0,
        2,
        Fuel,
        |d| ab(d) * 0.079
    ),
    pid!(
        0x23,
        "fuel_rail_pressure",
        "kPa",
        0.0,
        655350.0,
        2,
        Fuel,
        |d| ab(d) * 10.0
    ),
    pid!(
        0x2C,
        "egr_commanded",
        "%",
        0.0,
        100.0,
        1,
        Emissions,
        percent
    ),
    pid!(0x2E, "evap_purge", "%", 0.0, 100.0, 1, Emissions, percent),
    pid!(0x2F, "fuel_level", "%", 0.0, 100.0, 1, Fuel, percent),
    pid!(0x30, "warmups_since_clear", "", 0.0, 255.0, 1, Vehicle, a),
    pid!(
        0x31,
        "distance_since_clear",
        "km",
        0.0,
        65535.0,
        2,
        Vehicle,
        ab
    ),
    pid!(0x33, "baro_pressure", "kPa", 0.0, 255.0, 1, Air, a),
    pid!(
        0x3C,
        "catalyst_temp_b1s1",
        "°C",
        -40.0,
        1000.0,
        2,
        Emissions,
        |d| ab(d) / 10.0 - 40.0
    ),
    pid!(
        0x3D,
        "catalyst_temp_b2s1",
        "°C",
        -40.0,
        1000.0,
        2,
        Emissions,
        |d| ab(d) / 10.0 - 40.0
    ),
    pid!(
        0x42,
        "module_voltage",
        "V",
        0.0,
        18.0,
        2,
        Electrical,
        |d| ab(d) / 1000.0
    ),
    pid!(0x43, "absolute_load", "%", 0.0, 400.0, 2, Engine, |d| ab(d)
        * 100.0
        / 255.0),
    pid!(0x44, "commanded_lambda", "λ", 0.0, 2.0, 2, Fuel, |d| ab(d)
        * 2.0
        / 65536.0),
    pid!(
        0x45,
        "relative_throttle",
        "%",
        0.0,
        100.0,
        1,
        Engine,
        percent
    ),
    pid!(
        0x46,
        "ambient_temp",
        "°C",
        -40.0,
        60.0,
        1,
        Temperature,
        temp
    ),
    pid!(0x47, "throttle_b", "%", 0.0, 100.0, 1, Engine, percent),
    pid!(0x49, "accel_pedal_d", "%", 0.0, 100.0, 1, Engine, percent),
    pid!(0x4A, "accel_pedal_e", "%", 0.0, 100.0, 1, Engine, percent),
    pid!(
        0x4C,
        "commanded_throttle",
        "%",
        0.0,
        100.0,
        1,
        Engine,
        percent
    ),
    pid!(0x4D, "time_with_mil", "min", 0.0, 65535.0, 2, Vehicle, ab),
    pid!(0x52, "ethanol_percent", "%", 0.0, 100.0, 1, Fuel, percent),
    pid!(0x5A, "relative_pedal", "%", 0.0, 100.0, 1, Engine, percent),
    pid!(0x5C, "oil_temp", "°C", -40.0, 160.0, 1, Temperature, temp),
    pid!(0x5E, "fuel_rate", "L/h", 0.0, 100.0, 2, Fuel, |d| ab(d)
        / 20.0),
];

/// Pseudo PID used for the adapter's own battery voltage reading (`ATRV`).
pub const BATTERY_VOLTAGE_KEY: &str = "battery_voltage";

pub fn find_by_key(key: &str) -> Option<&'static PidDef> {
    PIDS.iter().find(|d| d.key == key)
}

pub fn find(pid: u8) -> Option<&'static PidDef> {
    PIDS.iter().find(|d| d.pid == pid)
}

/// Full catalog for the UI, plus the `ATRV` pseudo PID.
pub fn catalog() -> Vec<PidMeta> {
    let mut v: Vec<PidMeta> = PIDS.iter().map(PidDef::meta).collect();
    v.push(PidMeta {
        pid: 0,
        key: BATTERY_VOLTAGE_KEY.into(),
        unit: "V".into(),
        min: 0.0,
        max: 18.0,
        category: PidCategory::Electrical,
    });
    v
}

/// Decodes the 4-byte bitmap answered to PID 00/20/40... into PID numbers.
pub fn decode_supported(base: u8, bitmap: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, byte) in bitmap.iter().take(4).enumerate() {
        for bit in 0..8 {
            if byte & (0x80 >> bit) != 0 {
                out.push(base + (i as u8) * 8 + bit + 1);
            }
        }
    }
    out
}

/// Inverse of [`decode_supported`], used by the simulator.
pub fn encode_supported(base: u8, pids: &[u8]) -> [u8; 4] {
    let mut out = [0u8; 4];
    for &p in pids {
        if p > base && p <= base.saturating_add(0x20) {
            let n = (p - base - 1) as usize;
            out[n / 8] |= 0x80 >> (n % 8);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(key: &str, data: &[u8]) -> f64 {
        find_by_key(key).unwrap().decode_value(data).unwrap().value
    }

    #[test]
    fn formulas() {
        assert_eq!(decode("rpm", &[0x1A, 0xF8]), 1726.0);
        assert_eq!(decode("coolant_temp", &[0x7B]), 83.0);
        assert_eq!(decode("speed", &[0x50]), 80.0);
        assert_eq!(decode("stft_b1", &[0x80]), 0.0);
        assert_eq!(decode("ltft_b1", &[0x85]), 3.906);
        assert_eq!(decode("maf", &[0x01, 0x2C]), 3.0);
        assert_eq!(decode("module_voltage", &[0x37, 0x1A]), 14.106);
        assert_eq!(decode("throttle", &[0xFF]), 100.0);
        assert_eq!(decode("o2_b1s1", &[0x5A, 0xFF]), 0.45);
        assert_eq!(decode("catalyst_temp_b1s1", &[0x11, 0x94]), 410.0);
    }

    #[test]
    fn too_few_bytes_is_error() {
        assert!(find_by_key("rpm").unwrap().decode_value(&[0x10]).is_err());
    }

    #[test]
    fn supported_bitmap_roundtrip() {
        // Classic example: 41 00 BE 1F A8 13
        let pids = decode_supported(0x00, &[0xBE, 0x1F, 0xA8, 0x13]);
        assert_eq!(
            pids,
            vec![
                1, 3, 4, 5, 6, 7, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x13, 0x15, 0x1C, 0x1F, 0x20
            ]
        );
        assert_eq!(encode_supported(0x00, &pids), [0xBE, 0x1F, 0xA8, 0x13]);
    }

    #[test]
    fn keys_are_unique() {
        let mut keys: Vec<_> = PIDS.iter().map(|p| p.key).collect();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), PIDS.len());
    }
}
