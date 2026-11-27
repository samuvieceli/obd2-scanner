//! VIN (Vehicle Identification Number) decoding.
//!
//! The VIN has 17 characters: WMI (1-3, manufacturer), VDS (4-9, model;
//! position 9 is a check digit in North America) and VIS (10-17; 10 = model
//! year, 11 = plant, 12-17 = serial number).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VinInfo {
    pub vin: String,
    /// 17 characters, only allowed letters.
    pub valid_format: bool,
    /// `Some(true/false)` = check digit verified; `None` = not computable.
    pub check_digit_ok: Option<bool>,
    pub wmi: String,
    pub region: String,
    pub country: String,
    pub manufacturer: Option<String>,
    pub model_year: Option<u16>,
    pub plant_code: String,
    pub serial: String,
}

fn transliterate(c: char) -> Option<u32> {
    Some(match c {
        '0'..='9' => c.to_digit(10)?,
        'A' | 'J' => 1,
        'B' | 'K' | 'S' => 2,
        'C' | 'L' | 'T' => 3,
        'D' | 'M' | 'U' => 4,
        'E' | 'N' | 'V' => 5,
        'F' | 'W' => 6,
        'G' | 'P' | 'X' => 7,
        'H' | 'Y' => 8,
        'R' | 'Z' => 9,
        _ => return None,
    })
}

/// Computes the check digit (position 9) of a 17-char VIN.
pub fn check_digit(vin: &str) -> Option<char> {
    const WEIGHTS: [u32; 17] = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    if vin.len() != 17 {
        return None;
    }
    let mut sum = 0;
    for (c, w) in vin.chars().zip(WEIGHTS) {
        sum += transliterate(c)? * w;
    }
    let r = sum % 11;
    Some(if r == 10 {
        'X'
    } else {
        char::from_digit(r, 10)?
    })
}

/// Model year from position 10. Codes repeat every 30 years; picks the most
/// recent year that is not after `current_year + 1`.
pub fn model_year(code: char, current_year: u16) -> Option<u16> {
    const CODES: &str = "ABCDEFGHJKLMNPRSTVWXY123456789";
    let idx = CODES.find(code)? as u16;
    let mut year = 1980 + idx;
    while year + 30 <= current_year + 1 {
        year += 30;
    }
    Some(year)
}

fn region_country(wmi: &str) -> (&'static str, &'static str) {
    let c: Vec<char> = wmi.chars().collect();
    let (a, b) = (
        c.first().copied().unwrap_or(' '),
        c.get(1).copied().unwrap_or(' '),
    );
    let region = match a {
        'A'..='H' => "Africa",
        'J'..='R' => "Asia",
        'S'..='Z' => "Europe",
        '1'..='5' => "North America",
        '6' | '7' => "Oceania",
        '8' | '9' => "South America",
        _ => "",
    };
    let country = match (a, b) {
        ('9', 'A'..='E') | ('9', '3'..='9') => "Brazil",
        ('8', 'A'..='E') => "Argentina",
        ('8', 'X'..='Z') | ('8', '1'..='2') => "Venezuela",
        ('9', 'F'..='J') => "Colombia",
        ('1' | '4' | '5', _) => "United States",
        ('2', _) => "Canada",
        ('3', 'A'..='W') => "Mexico",
        ('J', _) => "Japan",
        ('K', 'L'..='R') => "South Korea",
        ('L', _) => "China",
        ('M', 'A'..='E') => "India",
        ('S', 'A'..='M') => "United Kingdom",
        ('V', 'F'..='R') => "France",
        ('V', 'S'..='W') => "Spain",
        ('W', _) => "Germany",
        ('Z', 'A'..='R') => "Italy",
        ('Y', 'S'..='W') => "Sweden",
        ('T', 'M'..='V') => "Czech Republic",
        _ => "",
    };
    (region, country)
}

/// Well-known manufacturer codes (WMI), with emphasis on cars sold in Brazil.
const WMI: &[(&str, &str)] = &[
    ("9BW", "Volkswagen (Brasil)"),
    ("9BG", "Chevrolet / GM (Brasil)"),
    ("9BD", "Fiat (Brasil)"),
    ("9BF", "Ford (Brasil)"),
    ("93H", "Honda (Brasil)"),
    ("9BR", "Toyota (Brasil)"),
    ("93Y", "Renault (Brasil)"),
    ("936", "Peugeot (Brasil)"),
    ("935", "Citroën (Brasil)"),
    ("9BH", "Hyundai (Brasil)"),
    ("93X", "Mitsubishi (Brasil)"),
    ("94D", "Nissan (Brasil)"),
    ("9BM", "Mercedes-Benz (Brasil)"),
    ("9C2", "Honda Motos (Brasil)"),
    ("9C6", "Yamaha (Brasil)"),
    ("988", "Jeep (Brasil)"),
    ("98R", "Chery (Brasil)"),
    ("99A", "Audi (Brasil)"),
    ("93Z", "Iveco (Brasil)"),
    ("95P", "CAOA (Brasil)"),
    ("8AP", "Fiat (Argentina)"),
    ("8AJ", "Toyota (Argentina)"),
    ("8AW", "Volkswagen (Argentina)"),
    ("8AF", "Ford (Argentina)"),
    ("8AG", "Chevrolet (Argentina)"),
    ("8A1", "Renault (Argentina)"),
    ("WVW", "Volkswagen"),
    ("WV1", "Volkswagen Commercial"),
    ("WV2", "Volkswagen Bus/Van"),
    ("WAU", "Audi"),
    ("WBA", "BMW"),
    ("WDD", "Mercedes-Benz"),
    ("WDB", "Mercedes-Benz"),
    ("WP0", "Porsche"),
    ("W0L", "Opel"),
    ("VF1", "Renault"),
    ("VF3", "Peugeot"),
    ("VF7", "Citroën"),
    ("ZFA", "Fiat"),
    ("JHM", "Honda"),
    ("JT", "Toyota"),
    ("JN", "Nissan"),
    ("JM", "Mazda"),
    ("JS", "Suzuki"),
    ("KMH", "Hyundai"),
    ("KNA", "Kia"),
    ("KND", "Kia"),
    ("1G", "General Motors"),
    ("1F", "Ford"),
    ("1HG", "Honda (USA)"),
    ("2T", "Toyota (Canada)"),
    ("3VW", "Volkswagen (Mexico)"),
    ("3N", "Nissan (Mexico)"),
    ("5YJ", "Tesla"),
    ("LSV", "SAIC Volkswagen"),
    ("LFV", "FAW-Volkswagen"),
    ("LGW", "Great Wall"),
    ("LB3", "Geely"),
    ("LC0", "BYD"),
];

/// Decodes a VIN. `current_year` is used to resolve the model year cycle.
pub fn decode_vin(vin: &str, current_year: u16) -> VinInfo {
    let vin: String = vin.trim().to_ascii_uppercase();
    let valid_format = vin.len() == 17
        && vin
            .chars()
            .all(|c| c.is_ascii_alphanumeric() && !matches!(c, 'I' | 'O' | 'Q'));
    let wmi = vin.chars().take(3).collect::<String>();
    let (region, country) = region_country(&wmi);
    let manufacturer = WMI
        .iter()
        .filter(|(prefix, _)| wmi.starts_with(prefix))
        .max_by_key(|(prefix, _)| prefix.len())
        .map(|(_, name)| name.to_string());
    let check_digit_ok = if valid_format {
        check_digit(&vin).map(|c| vin.chars().nth(8) == Some(c))
    } else {
        None
    };
    VinInfo {
        model_year: if valid_format {
            vin.chars().nth(9).and_then(|c| model_year(c, current_year))
        } else {
            None
        },
        plant_code: vin.chars().nth(10).map(String::from).unwrap_or_default(),
        serial: vin.chars().skip(11).collect(),
        valid_format,
        check_digit_ok,
        region: region.into(),
        country: country.into(),
        manufacturer,
        wmi,
        vin,
    }
}

/// Builds the ASCII text of a mode 09 answer (VIN, calibration ID, ECU name).
///
/// * CAN: one message `49 PID N <ascii...>` (N = number of items).
/// * Older protocols: several messages `49 PID SEQ b1 b2 b3 b4`.
pub fn assemble_mode09_string(messages: &[Vec<u8>], can: bool) -> Option<String> {
    let mut bytes = Vec::new();
    if can || messages.len() == 1 {
        let m = messages.first()?;
        let mut data = m.get(2..)?;
        // Skip the item count byte when present (it is never printable).
        if data.first().is_some_and(|b| *b < 0x20) {
            data = &data[1..];
        }
        bytes.extend_from_slice(data);
    } else {
        let mut sorted: Vec<&Vec<u8>> = messages.iter().filter(|m| m.len() > 3).collect();
        sorted.sort_by_key(|m| m[2]);
        for m in sorted {
            bytes.extend_from_slice(&m[3..]);
        }
    }
    let text: String = bytes
        .into_iter()
        .filter(|b| b.is_ascii_graphic())
        .map(|b| b as char)
        .collect();
    if text.is_empty() { None } else { Some(text) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_digit_of_known_vin() {
        // Example VIN widely used in documentation.
        assert_eq!(check_digit("1M8GDM9AXKP042788"), Some('X'));
        assert_eq!(check_digit("1HGCM82633A004352"), Some('3'));
    }

    #[test]
    fn decodes_us_vin() {
        let v = decode_vin("1HGCM82633A004352", 2026);
        assert!(v.valid_format);
        assert_eq!(v.check_digit_ok, Some(true));
        assert_eq!(v.manufacturer.as_deref(), Some("Honda (USA)"));
        assert_eq!(v.model_year, Some(2003));
        assert_eq!(v.country, "United States");
    }

    #[test]
    fn decodes_brazilian_vin() {
        let v = decode_vin("9BWAB45U8LT012345", 2026);
        assert!(v.valid_format);
        assert_eq!(v.manufacturer.as_deref(), Some("Volkswagen (Brasil)"));
        assert_eq!(v.country, "Brazil");
        assert_eq!(v.model_year, Some(2020));
    }

    #[test]
    fn model_year_cycle() {
        assert_eq!(model_year('A', 2026), Some(2010));
        assert_eq!(model_year('T', 2026), Some(2026));
        assert_eq!(model_year('V', 2026), Some(2027));
        assert_eq!(model_year('W', 2026), Some(1998));
        assert_eq!(model_year('Y', 2026), Some(2000));
        assert_eq!(model_year('I', 2026), None);
    }

    #[test]
    fn rejects_bad_format() {
        let v = decode_vin("ABC", 2026);
        assert!(!v.valid_format);
        assert_eq!(v.check_digit_ok, None);
    }

    #[test]
    fn mode09_can_and_legacy() {
        let can = vec![
            [0x49, 0x02, 0x01]
                .iter()
                .copied()
                .chain(*b"1HGCM82633A004352")
                .collect(),
        ];
        assert_eq!(
            assemble_mode09_string(&can, true).as_deref(),
            Some("1HGCM82633A004352")
        );

        let legacy = vec![
            vec![0x49, 0x02, 0x02, b'G', b'C', b'M', b'8'],
            vec![0x49, 0x02, 0x01, 0x00, 0x00, 0x00, b'1'],
            vec![0x49, 0x02, 0x03, b'2', b'6', b'3', b'3'],
            vec![0x49, 0x02, 0x04, b'A', b'0', b'0', b'4'],
            vec![0x49, 0x02, 0x05, b'3', b'5', b'2', b'H'],
        ];
        // Not a real VIN layout, only checks ordering and NUL removal.
        assert_eq!(
            assemble_mode09_string(&legacy, false).as_deref(),
            Some("1GCM82633A004352H")
        );
    }
}
