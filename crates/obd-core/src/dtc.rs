//! Diagnostic Trouble Codes (DTC): decoding and descriptions.
//!
//! Descriptions of generic codes come from `data/dtc_descriptions.json`
//! (English and Brazilian Portuguese). Codes not in the file still get a
//! description of the affected system, derived from the code structure
//! (SAE J2012), so the user always sees something useful.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// A trouble code such as `P0301`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Dtc(pub String);

impl std::fmt::Display for Dtc {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Decodes two bytes into a code. `0000` (padding) returns `None`.
pub fn decode_dtc(a: u8, b: u8) -> Option<Dtc> {
    if a == 0 && b == 0 {
        return None;
    }
    let letter = ['P', 'C', 'B', 'U'][(a >> 6) as usize];
    Some(Dtc(format!(
        "{letter}{}{:X}{:02X}",
        (a >> 4) & 0x03,
        a & 0x0F,
        b
    )))
}

/// Encodes a code back into two bytes (used by the simulator).
pub fn encode_dtc(code: &str) -> Option<[u8; 2]> {
    let c = code.as_bytes();
    if c.len() != 5 {
        return None;
    }
    let letter = match c[0].to_ascii_uppercase() {
        b'P' => 0u8,
        b'C' => 1,
        b'B' => 2,
        b'U' => 3,
        _ => return None,
    };
    let d1 = (c[1] as char).to_digit(4)? as u8;
    let d2 = (c[2] as char).to_digit(16)? as u8;
    let b = u8::from_str_radix(&code[3..5], 16).ok()?;
    Some([(letter << 6) | (d1 << 4) | d2, b])
}

/// Decodes the payload of a mode 03/07/0A answer (without the `43` byte).
/// On CAN the first byte is the number of codes; other protocols pad with `00 00`.
pub fn decode_dtc_response(payload: &[u8], can: bool) -> Vec<Dtc> {
    let mut data = payload;
    // On CAN the count byte makes the length odd.
    if can || data.len() % 2 == 1 {
        data = &data[1.min(data.len())..];
    }
    data.chunks_exact(2)
        .filter_map(|c| decode_dtc(c[0], c[1]))
        .collect()
}

/// Description shown to the user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DtcInfo {
    pub code: String,
    /// Text in the requested language.
    pub description: String,
    /// System affected (powertrain, chassis, body, network...).
    pub system: String,
    /// `true` when the code is defined by SAE (same meaning on every car).
    pub generic: bool,
    /// `true` when the description came from the database, `false` when only
    /// the system could be inferred.
    pub known: bool,
}

type Db = HashMap<String, HashMap<String, String>>;

fn db() -> &'static Db {
    static DB: OnceLock<Db> = OnceLock::new();
    DB.get_or_init(|| {
        serde_json::from_str(include_str!("../data/dtc_descriptions.json"))
            .expect("valid DTC database")
    })
}

fn is_pt(lang: &str) -> bool {
    lang.to_ascii_lowercase().starts_with("pt")
}

/// Generic codes: second char 0 (and 2 for P, 3 for P3400-P3999 partially).
fn is_generic(code: &str) -> bool {
    let c: Vec<char> = code.chars().collect();
    match (c.first(), c.get(1)) {
        (Some('P'), Some('0' | '2')) => true,
        (Some('P'), Some('3')) => c.get(2).is_some_and(|&d| d >= '4'),
        (Some('U'), Some('0' | '3')) => true,
        (Some(_), Some('0')) => true,
        _ => false,
    }
}

fn system_of(code: &str, pt: bool) -> String {
    let c: Vec<char> = code.chars().collect();
    let pick = |en: &str, ptx: &str| if pt { ptx.to_string() } else { en.to_string() };
    match c.first() {
        Some('P') => {
            let sub = match c.get(2) {
                Some('0') => pick(
                    "fuel/air metering and auxiliary emission controls",
                    "medição de ar/combustível e controles auxiliares de emissão",
                ),
                Some('1') | Some('2') => pick(
                    "fuel and air metering",
                    "medição de combustível e ar (injeção)",
                ),
                Some('3') => pick(
                    "ignition system or misfire",
                    "sistema de ignição ou falha de combustão",
                ),
                Some('4') => pick(
                    "auxiliary emission controls",
                    "controles auxiliares de emissão",
                ),
                Some('5') => pick(
                    "vehicle speed, idle control and auxiliary inputs",
                    "velocidade, controle de marcha lenta e entradas auxiliares",
                ),
                Some('6') => pick(
                    "computer and output circuits",
                    "módulo de controle (ECU) e circuitos de saída",
                ),
                Some('7') | Some('8') | Some('9') => pick("transmission", "transmissão (câmbio)"),
                Some('A') | Some('B') | Some('C') => pick("hybrid propulsion", "propulsão híbrida"),
                _ => String::new(),
            };
            let main = pick("Powertrain", "Motor e transmissão");
            if sub.is_empty() {
                main
            } else {
                format!("{main}: {sub}")
            }
        }
        Some('C') => pick(
            "Chassis (brakes, ABS, suspension, steering)",
            "Chassi (freios, ABS, suspensão, direção)",
        ),
        Some('B') => pick(
            "Body (airbag, climate, lighting, comfort)",
            "Carroceria (airbag, climatização, iluminação, conforto)",
        ),
        Some('U') => pick(
            "Network / communication between modules",
            "Rede / comunicação entre módulos",
        ),
        _ => String::new(),
    }
}

/// Looks up a code. `lang` is `pt-BR`, `en-US`, etc.
pub fn describe(code: &str, lang: &str) -> DtcInfo {
    let pt = is_pt(lang);
    let code_up = code.trim().to_ascii_uppercase();
    let generic = is_generic(&code_up);
    let system = system_of(&code_up, pt);
    let found = db()
        .get(&code_up)
        .and_then(|m| m.get(if pt { "pt" } else { "en" }));
    let (description, known) = match found {
        Some(text) => (text.clone(), true),
        None => {
            let text = match (pt, generic) {
                (true, true) => format!("Código genérico sem descrição na base. Sistema: {system}"),
                (true, false) => format!("Código específico do fabricante. Sistema: {system}. Consulte o manual de serviço do veículo."),
                (false, true) => format!("Generic code not in the database. System: {system}"),
                (false, false) => format!("Manufacturer-specific code. System: {system}. Check the vehicle service manual."),
            };
            (text, false)
        }
    };
    DtcInfo {
        code: code_up,
        description,
        system,
        generic,
        known,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_codes() {
        assert_eq!(decode_dtc(0x01, 0x33), Some(Dtc("P0133".into())));
        assert_eq!(decode_dtc(0x04, 0x20), Some(Dtc("P0420".into())));
        assert_eq!(decode_dtc(0xC1, 0x00), Some(Dtc("U0100".into())));
        assert_eq!(decode_dtc(0x41, 0x23), Some(Dtc("C0123".into())));
        assert_eq!(decode_dtc(0x9A, 0xBC), Some(Dtc("B1ABC".into())));
        assert_eq!(decode_dtc(0, 0), None);
    }

    #[test]
    fn encode_roundtrip() {
        for code in ["P0301", "P0420", "U0100", "C0035", "B1ABC", "P2196"] {
            let [a, b] = encode_dtc(code).unwrap();
            assert_eq!(decode_dtc(a, b).unwrap().0, code);
        }
    }

    #[test]
    fn response_can_and_legacy() {
        // CAN: count byte first.
        assert_eq!(
            decode_dtc_response(&[0x02, 0x01, 0x33, 0x04, 0x20], true),
            vec![Dtc("P0133".into()), Dtc("P0420".into())]
        );
        // ISO 9141 / KWP: padded with zeros.
        assert_eq!(
            decode_dtc_response(&[0x01, 0x33, 0x00, 0x00, 0x00, 0x00], false),
            vec![Dtc("P0133".into())]
        );
        assert!(decode_dtc_response(&[0x00], true).is_empty());
    }

    #[test]
    fn descriptions() {
        let d = describe("p0301", "pt-BR");
        assert!(d.known && d.generic);
        assert!(d.description.contains("cilindro 1"));
        let d = describe("P0301", "en-US");
        assert!(d.description.contains("Cylinder 1"));
        let d = describe("P1234", "pt-BR");
        assert!(!d.known && !d.generic);
        assert!(d.description.contains("fabricante"));
    }
}
