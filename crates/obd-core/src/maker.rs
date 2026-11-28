//! Manufacturer parameters: readings a car maker adds beyond the standard
//! (oil temperature, engaged gear, battery state of charge...).
//!
//! Standard live data (mode 01, [`crate::pid`]) means the same on every car.
//! Manufacturer data is read with service 0x21 or 0x22 sent to one control
//! unit, and each maker numbers it its own way, so the program needs a table
//! per car model. The tables come from OBDb (<https://github.com/OBDb>,
//! CC BY-SA 4.0), built into `data/maker_params.json` by
//! `tools/obdb_import.py`. Only requests that read are imported: none needs
//! a diagnostic session or any other change in the control unit.
//!
//! OBDb marks each request as confirmed on real cars of some model years, or
//! not confirmed at all. [`params`] passes that on as `verified`, and the UI
//! hides unconfirmed ones unless the user asks for experimental parameters.
//! Even confirmed data may come from a car of another market with another
//! engine, so the UI always says where the data comes from.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::elm327::{Addressing, Elm327};
use crate::pid::{PidCategory, PidMeta};
use crate::{ObdError, Result};

/// Prefix of every manufacturer parameter key (`mfr_corolla_eot`).
pub const KEY_PREFIX: &str = "mfr_";

#[derive(Debug, Deserialize)]
struct Catalog {
    models: Vec<Model>,
}

#[derive(Debug, Deserialize)]
struct Model {
    id: String,
    make: String,
    model: String,
    commands: Vec<Command>,
    /// Model years described by other OBDb files (another generation of
    /// the car): the data here is not confirmed for them.
    #[serde(default)]
    other_years: Vec<(u16, u16)>,
}

/// Model years, as OBDb writes them: a range (`from`..=`to`), the years
/// outside it when `from` > `to`, and single `years`.
#[derive(Debug, Default, Deserialize)]
struct Years {
    from: Option<u16>,
    to: Option<u16>,
    #[serde(default)]
    years: Vec<u16>,
}

impl Years {
    /// Same rule as OBDb's own tools (`Filter.matches`).
    fn matches(&self, year: u16) -> bool {
        let range = match (self.from, self.to) {
            (Some(f), Some(t)) if f < t => (f..=t).contains(&year),
            (Some(f), Some(t)) => year >= f || year <= t,
            (None, Some(t)) => year <= t,
            (Some(f), None) => year >= f,
            (None, None) => false,
        };
        range || self.years.contains(&year)
    }
}

/// One request and the parameters its answer carries.
#[derive(Debug, Deserialize)]
struct Command {
    /// Request header: `7E0` (11-bit) or `DA10` (29-bit, sender F1 added).
    hdr: String,
    /// Answer address; missing = the usual one for the header.
    rax: Option<String>,
    svc: u8,
    /// Identifier after the service, hex (`1002` for 22 1002).
    id: String,
    #[serde(default)]
    fc: bool,
    /// Never confirmed on a real car.
    #[serde(default)]
    dbg: bool,
    /// Model years in which it is still unconfirmed.
    dbg_years: Option<Years>,
    /// Model years it applies to (missing = all).
    years: Option<Years>,
    signals: Vec<Signal>,
}

#[derive(Debug, Deserialize)]
struct Signal {
    key: String,
    name: String,
    name_pt: String,
    group: String,
    unit: String,
    /// First bit, counted from the most significant bit of the first data
    /// byte after the echo.
    bix: usize,
    len: usize,
    #[serde(default)]
    sign: bool,
    /// Bytes in little-endian order.
    #[serde(default)]
    blsb: bool,
    #[serde(default = "one")]
    factor: f64,
    #[serde(default)]
    add: f64,
    min: f64,
    max: f64,
    nullmin: Option<f64>,
    nullmax: Option<f64>,
    states: Option<Vec<State>>,
}

fn one() -> f64 {
    1.0
}

/// A named raw value (on/off, a gear...). `word` is a fixed meaning the UI
/// translates (`on`, `off`, `yes`, `no`); otherwise `en`/`pt` name it.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct State {
    pub raw: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub en: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pt: Option<String>,
}

fn catalog() -> &'static Catalog {
    static DB: OnceLock<Catalog> = OnceLock::new();
    DB.get_or_init(|| {
        serde_json::from_str(include_str!("../data/maker_params.json"))
            .expect("maker_params.json is valid")
    })
}

/// Key -> (model, command, signal) indexes.
fn index() -> &'static HashMap<&'static str, (usize, usize, usize)> {
    static INDEX: OnceLock<HashMap<&'static str, (usize, usize, usize)>> = OnceLock::new();
    INDEX.get_or_init(|| {
        let mut map = HashMap::new();
        for (m, model) in catalog().models.iter().enumerate() {
            for (c, cmd) in model.commands.iter().enumerate() {
                for (s, sig) in cmd.signals.iter().enumerate() {
                    map.insert(sig.key.as_str(), (m, c, s));
                }
            }
        }
        map
    })
}

/// A car model with manufacturer data, for the model list.
#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub make: String,
    pub model: String,
    pub params: usize,
    /// Parameters confirmed on a real car in some model year.
    pub verified: usize,
}

pub fn models() -> Vec<ModelInfo> {
    catalog()
        .models
        .iter()
        .map(|m| ModelInfo {
            id: m.id.clone(),
            make: m.make.clone(),
            model: m.model.clone(),
            params: m.commands.iter().map(|c| c.signals.len()).sum(),
            verified: m
                .commands
                .iter()
                .filter(|c| !c.dbg)
                .map(|c| c.signals.len())
                .sum(),
        })
        .collect()
}

/// One manufacturer parameter, described for the UI.
#[derive(Debug, Clone, Serialize)]
pub struct MakerParam {
    pub key: String,
    pub name: String,
    /// OBDb group (`Engine`, `Transmission`, `Battery`...); the UI names it.
    pub group: String,
    pub unit: String,
    pub min: f64,
    pub max: f64,
    /// Confirmed on a real car (in this model year, when it is known).
    pub verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub states: Option<Vec<State>>,
}

/// Parameters of a model, for `year` when known (requests made for other
/// years are left out). `lang` "pt-BR" gives Portuguese names, anything
/// else English.
pub fn params(model_id: &str, year: Option<u16>, lang: &str) -> Vec<MakerParam> {
    let Some(model) = catalog().models.iter().find(|m| m.id == model_id) else {
        return Vec::new();
    };
    let pt = lang.starts_with("pt");
    let other_generation = year.is_some_and(|y| {
        model
            .other_years
            .iter()
            .any(|&(from, to)| (from..=to).contains(&y))
    });
    let mut out = Vec::new();
    for cmd in &model.commands {
        if let (Some(y), Some(years)) = (year, &cmd.years)
            && !years.matches(y)
        {
            continue;
        }
        let verified = !cmd.dbg
            && !other_generation
            && match (year, &cmd.dbg_years) {
                (Some(y), Some(d)) => !d.matches(y),
                _ => true,
            };
        for s in &cmd.signals {
            out.push(MakerParam {
                key: s.key.clone(),
                name: if pt {
                    s.name_pt.clone()
                } else {
                    s.name.clone()
                },
                group: s.group.clone(),
                unit: s.unit.clone(),
                min: s.min,
                max: s.max,
                verified,
                states: s.states.clone(),
            });
        }
    }
    out
}

/// Description for recordings, so a saved file keeps the unit and range.
pub fn meta(key: &str) -> Option<PidMeta> {
    let (s, _) = find(key)?;
    Some(PidMeta {
        pid: 0,
        key: s.key.clone(),
        unit: s.unit.clone(),
        min: s.min,
        max: s.max,
        category: PidCategory::Vehicle,
    })
}

fn find(key: &str) -> Option<(&'static Signal, &'static Command)> {
    let &(m, c, s) = index().get(key)?;
    let cmd = &catalog().models[m].commands[c];
    Some((&cmd.signals[s], cmd))
}

/// The request that reads `key`. Keys read by the same request share it,
/// so they are asked for once per cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RequestId(usize, usize);

pub fn request_of(key: &str) -> Option<RequestId> {
    index().get(key).map(|&(m, c, _)| RequestId(m, c))
}

impl Command {
    fn addressing(&self) -> Addressing {
        if self.hdr.len() == 3 {
            let receive = self.rax.clone().unwrap_or_else(|| {
                let id = u16::from_str_radix(&self.hdr, 16).unwrap_or(0x7E0);
                format!("{:03X}", id + 8)
            });
            return Addressing {
                header: self.hdr.clone(),
                receive,
                flow_control: self.fc,
            };
        }
        // 29-bit: "DA10" -> header DA10F1, answer 18DAF110 (or the rax).
        let receive = match self.rax.as_deref() {
            Some(r) if r.len() == 8 => r.to_string(),
            Some(r) if r.len() == 6 => format!("18{r}"),
            Some(r) => format!("18DAF1{r:0>2}"),
            None => format!("18DAF1{}", &self.hdr[2..]),
        };
        Addressing {
            header: format!("{}F1", self.hdr),
            receive,
            flow_control: self.fc,
        }
    }
}

/// Reads one request and returns `(key, value)` for each of `keys` that it
/// carries and that has a valid value. A request that answers with too few
/// bytes, or a value on a "no value" bound, leaves that key out.
pub fn read(elm: &mut Elm327, request: RequestId, keys: &[String]) -> Result<Vec<(String, f64)>> {
    let RequestId(m, c) = request;
    let cmd = catalog()
        .models
        .get(m)
        .and_then(|model| model.commands.get(c))
        .ok_or(ObdError::Parse("unknown manufacturer request".into()))?;
    let id = (0..cmd.id.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&cmd.id[i..i + 2], 16))
        .collect::<std::result::Result<Vec<u8>, _>>()
        .map_err(|_| ObdError::Parse(format!("bad identifier {}", cmd.id)))?;
    let data = elm.read_manufacturer(&cmd.addressing(), cmd.svc, &id)?;
    Ok(cmd
        .signals
        .iter()
        .filter(|s| keys.contains(&s.key))
        .filter_map(|s| decode(s, &data).map(|v| (s.key.clone(), v)))
        .collect())
}

/// Value of a signal in the answer data (OBDb's `Scaling.decode_value`).
fn decode(s: &Signal, data: &[u8]) -> Option<f64> {
    let raw = bits(data, s.bix, s.len, s.blsb)?;
    if s.states.is_some() {
        return Some(raw as f64);
    }
    let raw = if s.sign && s.len < 64 && raw & (1 << (s.len - 1)) != 0 {
        raw as i64 - (1i64 << s.len)
    } else {
        raw as i64
    };
    let mut v = raw as f64 * s.factor + s.add;
    if s.max > s.min {
        v = v.clamp(s.min, s.max);
    }
    if s.nullmin.is_some_and(|n| v <= n + f64::EPSILON)
        || s.nullmax.is_some_and(|n| v >= n - f64::EPSILON)
    {
        return None;
    }
    Some((v * 1000.0).round() / 1000.0)
}

/// `len` bits from bit `start` (bit 0 = most significant bit of byte 0).
/// With `lsb_first`, the bytes holding the value are read in reverse order.
fn bits(data: &[u8], start: usize, len: usize, lsb_first: bool) -> Option<u64> {
    if len == 0 || len > 64 || start + len > data.len() * 8 {
        return None;
    }
    let mut bytes = data.to_vec();
    if lsb_first && len > 8 {
        let first = start / 8;
        let last = (first + len.div_ceil(8)).min(bytes.len());
        bytes[first..last].reverse();
    }
    let mut v = 0u64;
    for i in start..start + len {
        let bit = (bytes[i / 8] >> (7 - i % 8)) & 1;
        v = (v << 1) | bit as u64;
    }
    Some(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_loads_and_keys_are_unique() {
        let total: usize = models().iter().map(|m| m.params).sum();
        assert!(total > 1000, "{total}");
        assert_eq!(index().len(), total, "duplicate keys");
        assert!(index().keys().all(|k| k.starts_with(KEY_PREFIX)));
    }

    #[test]
    fn only_read_services() {
        for m in &catalog().models {
            for c in &m.commands {
                assert!(matches!(c.svc, 0x21 | 0x22), "{} {}", m.id, c.id);
                assert!(matches!(c.hdr.len(), 3 | 4));
            }
        }
    }

    #[test]
    fn bit_extraction() {
        // Peugeot 208 engine speed: 62 D4 00 | 02 EC -> 748 rpm (OBDb test).
        assert_eq!(bits(&[0x02, 0xEC], 0, 16, false), Some(748));
        assert_eq!(bits(&[0b1010_0000], 0, 3, false), Some(0b101));
        assert_eq!(bits(&[0x00, 0b0001_0000], 11, 1, false), Some(1));
        assert_eq!(bits(&[0x34, 0x12], 0, 16, true), Some(0x1234));
        assert_eq!(bits(&[0x01], 0, 16, false), None);
    }

    #[test]
    fn decodes_like_obdb() {
        // Peugeot 208 speed, OBDb test: 688 05 62 D4 02 00 FD -> 1.97656 km/h.
        let speed = find("mfr_208_vss_6a8").unwrap().0;
        assert_eq!(decode(speed, &[0x00, 0xFD]), Some(1.977));
        assert_eq!(decode(speed, &[0x00, 0x00]), Some(0.0));
    }

    /// Checks the decoder against every answer recorded in OBDb's own tests.
    /// Run with `OBDB_CASES=cases.json cargo test -- --ignored`, where the
    /// file is a list of `{key, data (hex after the echo), expected}`.
    #[test]
    #[ignore]
    fn obdb_recorded_answers() {
        #[derive(Deserialize)]
        struct Case {
            key: String,
            data: String,
            expected: f64,
        }
        let path = std::env::var("OBDB_CASES").expect("OBDB_CASES");
        let cases: Vec<Case> =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let mut wrong = Vec::new();
        for c in &cases {
            let data: Vec<u8> = (0..c.data.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&c.data[i..i + 2], 16).unwrap())
                .collect();
            let (sig, _) = find(&c.key).unwrap();
            if data.len() * 8 < sig.bix + sig.len {
                continue; // a short answer: the program shows no value
            }
            // Expected values are already converted to the program's units.
            let got = decode(sig, &data);
            let ok = got
                .is_some_and(|v| (v - c.expected).abs() <= 0.01_f64.max(c.expected.abs() * 1e-3));
            if !ok {
                wrong.push(format!(
                    "{} {} expected {} got {:?}",
                    c.key, c.data, c.expected, got
                ));
            }
        }
        assert!(
            wrong.is_empty(),
            "{} of {} wrong:\n{}",
            wrong.len(),
            cases.len(),
            wrong[..wrong.len().min(30)].join("\n")
        );
    }

    #[test]
    fn signed_values() {
        let s = Signal {
            key: String::new(),
            name: String::new(),
            name_pt: String::new(),
            group: String::new(),
            unit: "°C".into(),
            bix: 0,
            len: 8,
            sign: true,
            blsb: false,
            factor: 1.0,
            add: 0.0,
            min: -40.0,
            max: 215.0,
            nullmin: None,
            nullmax: None,
            states: None,
        };
        assert_eq!(decode(&s, &[0xF6]), Some(-10.0));
        assert_eq!(decode(&s, &[0x7F]), Some(127.0));
    }

    #[test]
    fn year_filters_follow_obdb() {
        let window = Years {
            from: Some(2015),
            to: Some(2019),
            years: vec![],
        };
        assert!(window.matches(2017) && !window.matches(2020));
        // from > to: the years outside, e.g. still unconfirmed except 2021.
        let outside = Years {
            from: Some(2022),
            to: Some(2020),
            years: vec![],
        };
        assert!(outside.matches(2019) && outside.matches(2023) && !outside.matches(2021));
        let single = Years {
            from: None,
            to: None,
            years: vec![2024],
        };
        assert!(single.matches(2024) && !single.matches(2023));
    }

    #[test]
    fn verified_depends_on_model_year() {
        // The Peugeot 208 data was confirmed on a 2021 car only.
        let speed = |year, lang| {
            params("peugeot-208", year, lang)
                .into_iter()
                .find(|p| p.key == "mfr_208_vss_6a8")
                .unwrap()
        };
        assert!(speed(Some(2021), "pt-BR").verified);
        assert!(!speed(Some(2016), "pt-BR").verified);
        assert!(speed(None, "pt-BR").verified);
        // Ford Ranger: OBDb describes the 2005-2018 generation in another file.
        let ranger = |year| {
            params("ford-ranger", year, "en-US")
                .iter()
                .filter(|p| p.verified)
                .count()
        };
        assert!(ranger(Some(2022)) > 0);
        assert_eq!(ranger(Some(2015)), 0);
        assert_eq!(speed(None, "pt-BR").name, "Velocidade do veículo");
        assert_eq!(speed(None, "en-US").name, "Vehicle speed");
    }

    #[test]
    fn addressing_11_and_29_bit() {
        let cmd = |hdr: &str, rax: Option<&str>| Command {
            hdr: hdr.into(),
            rax: rax.map(Into::into),
            svc: 0x22,
            id: "1002".into(),
            fc: false,
            dbg: false,
            dbg_years: None,
            years: None,
            signals: vec![],
        };
        let a = cmd("7E0", None).addressing();
        assert_eq!((a.header.as_str(), a.receive.as_str()), ("7E0", "7E8"));
        let a = cmd("6A8", Some("688")).addressing();
        assert_eq!(a.receive, "688");
        let a = cmd("DA10", Some("10")).addressing();
        assert_eq!(
            (a.header.as_str(), a.receive.as_str()),
            ("DA10F1", "18DAF110")
        );
        let a = cmd("DA0E", None).addressing();
        assert_eq!(a.receive, "18DAF10E");
    }

    #[test]
    fn metas_for_recordings() {
        let m = meta("mfr_208_vss_6a8").unwrap();
        assert_eq!(m.unit, "km/h");
        assert!(meta("rpm").is_none());
    }
}
