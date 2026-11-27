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
        // South America (ISO 3780 ranges, as listed on Wikibooks).
        ('9', 'A'..='E') | ('9', '0'..='9') => "Brazil",
        ('9', 'F'..='G') => "Colombia",
        ('9', 'S'..='V') => "Uruguay",
        ('8', 'A'..='E') => "Argentina",
        ('8', 'F'..='G') => "Chile",
        ('8', 'L'..='N') => "Ecuador",
        ('8', 'S'..='T') => "Peru",
        ('8', 'X'..='Z') => "Venezuela",
        ('8', '2') => "Bolivia",
        ('1' | '4' | '5', _) => "United States",
        ('2', _) => "Canada",
        ('3', 'A'..='W') => "Mexico",
        ('J', _) => "Japan",
        ('K', 'L'..='R') => "South Korea",
        ('L', _) => "China",
        ('M', 'A'..='E') => "India",
        ('M', 'F'..='K') => "Indonesia",
        ('M', 'L'..='R') => "Thailand",
        ('S', 'A'..='M') => "United Kingdom",
        ('S', 'N'..='T') => "Germany",
        ('V', 'F'..='R') => "France",
        ('V', 'S'..='W') => "Spain",
        ('W', _) => "Germany",
        ('Z', 'A'..='R') => "Italy",
        ('Y', 'S'..='W') => "Sweden",
        ('T', 'M'..='P') => "Czech Republic",
        ('T', 'R'..='V') => "Hungary",
        ('U', 'U'..='Z') => "Romania",
        ('N', 'L'..='R') => "Turkey",
        _ => "",
    };
    (region, country)
}

/// Well-known manufacturer codes (WMI), with emphasis on cars sold in Brazil.
///
/// Source: Wikibooks "Vehicle Identification Numbers (VIN codes)/World
/// Manufacturer Identifier (WMI)" (CC BY-SA 4.0), checked in 2026-11.
/// Names that contain a brand of `dtc::BRANDS` select that brand's
/// trouble-code table, so groups that build several brands are named without
/// one (e.g. "CAOA").
const WMI: &[(&str, &str)] = &[
    // Brazil: cars and light commercial vehicles.
    ("9BW", "Volkswagen (Brasil)"),
    ("9BG", "Chevrolet / GM (Brasil)"),
    ("93C", "Chevrolet / GM (Brasil, exportação)"),
    ("9BD", "Fiat (Brasil)"),
    ("93W", "Fiat Ducato (Iveco, Brasil, 2000–2016)"),
    ("988", "Jeep / Fiat (Goiana, Brasil)"),
    ("9BF", "Ford (Brasil)"),
    ("93H", "Honda (Brasil)"),
    ("9BR", "Toyota (Brasil)"),
    ("93R", "Toyota (Brasil)"),
    ("93Y", "Renault (Brasil)"),
    ("936", "Peugeot (Brasil)"),
    ("935", "Citroën (Brasil)"),
    ("9BH", "Hyundai (Brasil)"),
    ("95P", "CAOA Montadora (Anápolis, Brasil)"),
    ("93X", "Mitsubishi / Suzuki (HPE, Brasil)"),
    ("94D", "Nissan (Brasil)"),
    ("9BM", "Mercedes-Benz (Brasil)"),
    ("98M", "BMW (Brasil)"),
    ("93U", "Audi (Brasil, 1999–2006)"),
    ("99A", "Audi (Brasil)"),
    ("99J", "Jaguar Land Rover (Brasil)"),
    ("98R", "Chery (Brasil)"),
    ("94T", "Troller (Brasil)"),
    ("937", "Dodge (Brasil)"),
    ("9DF", "Puma (Brasil)"),
    ("92H", "Origem (Brasil)"),
    // Brazil: trucks and buses.
    ("93Z", "Iveco (Brasil)"),
    ("953", "VWCO / MAN Caminhões e Ônibus (Brasil)"),
    ("9BS", "Scania (Brasil)"),
    ("9BV", "Volvo Caminhões (Brasil)"),
    ("93K", "Volvo Caminhões (Brasil)"),
    ("98P", "DAF Caminhões (Brasil)"),
    ("93S", "Navistar International (Brasil)"),
    ("93V", "Navistar International (Brasil)"),
    ("93P", "Volare (Brasil)"),
    ("9BY", "Agrale (Brasil)"),
    ("9DW", "Kenworth / Peterbilt (Brasil)"),
    ("9BN", "Mafersa (Brasil)"),
    ("94N", "RWM (Brasil)"),
    // Brazil: motorcycles.
    ("9C2", "Honda Motos (Brasil)"),
    ("9C6", "Yamaha (Brasil)"),
    ("9CD", "Suzuki Motos (J. Toledo, Brasil)"),
    ("932", "Harley-Davidson (Brasil)"),
    ("95V", "Dafra (Brasil)"),
    ("95Z", "Buell (Brasil)"),
    ("96P", "Kawasaki (Brasil)"),
    ("97N", "Triumph (Brasil)"),
    ("99H", "Shineray (Brasil)"),
    ("99K", "Haojue / Kymco (JTZ, Brasil)"),
    ("99Z", "BMW Motorrad (Brasil)"),
    // Rest of South America (many are sold in Brazil).
    ("8AC", "Mercedes-Benz (Argentina)"),
    ("8AD", "Peugeot (Argentina)"),
    ("8AE", "Peugeot (Argentina)"),
    ("8AF", "Ford (Argentina)"),
    ("8AG", "Chevrolet (Argentina)"),
    ("8AJ", "Toyota (Argentina)"),
    ("8AK", "Suzuki (Argentina)"),
    ("8AN", "Nissan (Argentina)"),
    ("8AP", "Fiat (Argentina)"),
    ("8AT", "Iveco (Argentina)"),
    ("8AW", "Volkswagen (Argentina)"),
    ("8A1", "Renault (Argentina)"),
    ("8A3", "Scania (Argentina)"),
    ("8BB", "Agrale (Argentina)"),
    ("8BC", "Citroën (Argentina)"),
    ("8C3", "Honda (Argentina)"),
    ("8G1", "Renault (Chile)"),
    ("8GD", "Peugeot (Chile)"),
    ("8GG", "Chevrolet (Chile)"),
    ("8LD", "Chevrolet (Equador)"),
    ("9FB", "Renault (Colômbia)"),
    ("9GA", "Chevrolet (Colômbia)"),
    ("9UJ", "Chery (Uruguai)"),
    ("9UW", "Kia (Uruguai)"),
    // Mexico (common imports in Brazil).
    ("3VW", "Volkswagen (Mexico)"),
    ("3N1", "Nissan (Mexico)"),
    ("3N6", "Nissan (Mexico)"),
    ("3HG", "Honda (Mexico)"),
    ("3MZ", "Mazda (Mexico)"),
    ("3FA", "Ford (Mexico)"),
    ("3G1", "Chevrolet (Mexico)"),
    ("3VV", "Volkswagen (Mexico, SUV)"),
    ("3GN", "Chevrolet (SUV)"),
    ("3GC", "Chevrolet (picape)"),
    ("3KP", "Kia (Mexico)"),
    ("3N8", "Nissan (Mexico)"),
    ("3TM", "Toyota (picape, Mexico)"),
    ("3MD", "Mazda (Mexico)"),
    // Asia (common imports in Brazil).
    ("MR0", "Toyota (Tailândia)"),
    ("MMB", "Mitsubishi (Tailândia)"),
    ("MNT", "Nissan (Tailândia)"),
    ("MPA", "Isuzu (Tailândia)"),
    ("MRH", "Honda (Tailândia)"),
    ("MHF", "Toyota (Indonésia)"),
    ("MA3", "Suzuki (Índia)"),
    ("MAL", "Hyundai (Índia)"),
    ("MAJ", "Ford (Índia)"),
    ("KMH", "Hyundai"),
    ("KNA", "Kia"),
    ("KND", "Kia"),
    ("KNM", "Renault Samsung"),
    ("LVV", "Chery"),
    ("LJ1", "JAC"),
    ("LGW", "Great Wall (GWM, Haval)"),
    ("L6T", "Geely"),
    ("LRW", "Tesla (China)"),
    ("LSG", "Chevrolet (SAIC-GM, China)"),
    ("LSV", "SAIC Volkswagen"),
    ("LFV", "FAW-Volkswagen"),
    ("LB3", "Geely"),
    ("LC0", "BYD"),
    ("MMA", "Mitsubishi (Tailândia)"),
    ("MMC", "Mitsubishi (Tailândia)"),
    ("MZB", "Kia (Índia)"),
    ("KMT", "Genesis"),
    ("KMF", "Hyundai (comerciais)"),
    ("KNC", "Kia (caminhões)"),
    ("KL1", "Chevrolet (GM Coreia)"),
    ("KLA", "Chevrolet (GM Coreia)"),
    ("KPA", "SsangYong (picape)"),
    ("LVT", "Chery (Exeed)"),
    ("LHG", "Honda (China)"),
    ("LVG", "Toyota (China)"),
    ("LFM", "Toyota (China)"),
    ("LDC", "Peugeot / Citroën (China)"),
    ("JMB", "Mitsubishi"),
    ("JMY", "Mitsubishi"),
    ("JA4", "Mitsubishi (SUV)"),
    ("JF1", "Subaru"),
    ("JF2", "Subaru (SUV)"),
    ("JHM", "Honda"),
    ("JT", "Toyota"),
    ("JN", "Nissan"),
    ("JM", "Mazda"),
    ("JS", "Suzuki"),
    // Europe.
    ("WVW", "Volkswagen"),
    ("WVG", "Volkswagen (SUV)"),
    ("WV1", "Volkswagen Commercial"),
    ("WV2", "Volkswagen Bus/Van"),
    ("WAU", "Audi"),
    ("WBA", "BMW"),
    ("WDD", "Mercedes-Benz"),
    ("WDB", "Mercedes-Benz"),
    ("WP0", "Porsche"),
    ("W1K", "Mercedes-Benz"),
    ("W1N", "Mercedes-Benz (SUV)"),
    ("W1V", "Mercedes-Benz (van)"),
    ("WDC", "Mercedes-Benz (SUV)"),
    ("WBY", "BMW (elétrico)"),
    ("WP1", "Porsche (SUV)"),
    ("WUA", "Audi Sport"),
    ("WF0", "Ford (Alemanha)"),
    ("TRU", "Audi (Hungria)"),
    ("TMA", "Hyundai (República Tcheca)"),
    ("VWV", "Volkswagen (Espanha)"),
    ("VSK", "Nissan (Espanha)"),
    ("VNK", "Toyota (França)"),
    ("NMT", "Toyota (Turquia)"),
    ("UU1", "Dacia / Renault (Romênia)"),
    ("YV1", "Volvo"),
    ("YV4", "Volvo (SUV)"),
    ("ZAM", "Maserati"),
    ("ZFF", "Ferrari"),
    ("W0L", "Opel"),
    ("TMB", "Škoda"),
    ("VF1", "Renault"),
    ("VF3", "Peugeot"),
    ("VR3", "Peugeot"),
    ("VF7", "Citroën"),
    ("VR7", "Citroën"),
    ("ZFA", "Fiat"),
    ("ZAR", "Alfa Romeo"),
    ("SAL", "Land Rover"),
    ("SAJ", "Jaguar"),
    // North America.
    ("1G", "General Motors"),
    ("1F", "Ford"),
    ("1HG", "Honda (USA)"),
    ("2T", "Toyota (Canada)"),
    ("5YJ", "Tesla"),
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
    // Position 9 is a check digit only where the law requires it (North
    // America and China). Elsewhere, Brazil included, it is a normal model
    // character, so "wrong" would only confuse the user.
    let uses_check_digit = matches!(wmi.chars().next(), Some('1'..='5' | 'L'));
    let check_digit_ok = if valid_format && uses_check_digit {
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
    if can || messages.len() == 1 {
        // With several units answering, use the first one with text.
        return messages.iter().find_map(|m| {
            let mut data = m.get(2..)?;
            // Skip the item count byte when present (it is never printable).
            if data.first().is_some_and(|b| *b < 0x20) {
                data = &data[1..];
            }
            ascii_text(data)
        });
    }
    let mut sorted: Vec<&Vec<u8>> = messages.iter().filter(|m| m.len() > 3).collect();
    sorted.sort_by_key(|m| m[2]);
    let bytes: Vec<u8> = sorted.iter().flat_map(|m| m[3..].iter().copied()).collect();
    ascii_text(&bytes)
}

/// Printable text, keeping inner spaces (ECU names have them) and turning
/// NUL separators between items into one space.
fn ascii_text(bytes: &[u8]) -> Option<String> {
    let mut text = String::new();
    for &b in bytes {
        if b.is_ascii_graphic() {
            text.push(b as char);
        } else if (b == b' ' || b == 0) && !text.is_empty() && !text.ends_with(' ') {
            text.push(' ');
        }
    }
    let text = text.trim_end().to_string();
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
        // Brazilian VINs have no check digit: nothing to report.
        assert_eq!(v.check_digit_ok, None);
    }

    #[test]
    fn brazilian_and_south_american_wmis() {
        let maker = |vin: &str| decode_vin(vin, 2026).manufacturer;
        assert_eq!(
            maker("988611111LK000001").as_deref(),
            Some("Jeep / Fiat (Goiana, Brasil)")
        );
        assert_eq!(maker("98M111111LK000001").as_deref(), Some("BMW (Brasil)"));
        assert_eq!(
            maker("8AD111111LK000001").as_deref(),
            Some("Peugeot (Argentina)")
        );
        assert_eq!(decode_vin("99A111111LK000001", 2026).country, "Brazil");
        assert_eq!(decode_vin("9UJ111111LK000001", 2026).country, "Uruguay");
        assert_eq!(decode_vin("8GG111111LK000001", 2026).country, "Chile");
    }

    #[test]
    fn wmi_names_pick_the_right_trouble_code_table() {
        use crate::dtc::brand_from_manufacturer;
        let table =
            |vin: &str| brand_from_manufacturer(&decode_vin(vin, 2026).manufacturer.unwrap());
        assert_eq!(table("9BW111111LK000001"), Some("volkswagen"));
        assert_eq!(table("99A111111LK000001"), Some("audi"));
        // Groups that build several brands must not pick one table.
        assert_eq!(table("95P111111LK000001"), None);
        assert_eq!(table("953111111LK000001"), None);
        assert_eq!(table("9DW111111LK000001"), None);
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
            assemble_mode09_string(
                &[vec![0x49, 0x0A, 0x01], {
                    let mut m = vec![0x49, 0x0A, 0x01];
                    m.extend_from_slice(b"ECM\0-Engine Control\0\0");
                    m
                }],
                true
            )
            .as_deref(),
            Some("ECM -Engine Control")
        );
        assert_eq!(
            assemble_mode09_string(&legacy, false).as_deref(),
            Some("1GCM82633A004352H")
        );
    }
}
