//! Adapter compatibility test: which ELM327 version does it really behave as?
//!
//! Clones print any version (`v1.5`, `v2.1`, `v2.2`) but often implement only
//! the commands of ELM327 v1.0-v1.3. Each ELM327 firmware version added AT
//! commands, so trying a few commands of each version tells the real level.
//! Idea from DDT4ALL's `elm_checker` (GPL-3.0); the command list here keeps
//! only commands that read something or change a setting that `ATZ` resets.
//! Commands that write to the adapter's memory (`ATPP`, `ATCV`, `ATSD`,
//! `ATSP` with save, `ATBRD`, `ATLP`) are never sent.

use serde::Serialize;

use crate::Result;
use crate::elm327::Elm327;
use crate::response::clean_lines;

/// `(ELM327 version that introduced the command, command)`.
pub const PROBES: &[(&str, &str)] = &[
    ("1.0", "ATI"),
    ("1.0", "ATDP"),
    ("1.0", "ATRV"),
    ("1.0", "ATAL"),
    ("1.0", "ATCAF1"),
    ("1.0", "ATH0"),
    ("1.0", "ATR1"),
    ("1.1", "ATPPS"),
    ("1.1", "ATFCSM0"),
    ("1.2", "ATAT1"),
    ("1.2", "ATAR"),
    ("1.2", "ATKW0"),
    ("1.3", "ATD0"),
    ("1.3", "ATV0"),
    ("1.3", "ATJE"),
    ("1.3", "ATFE"),
    ("1.4", "ATIGN"),
    ("1.4", "ATCSM1"),
    ("1.4", "ATCEA"),
    ("1.4", "ATSS"),
    ("1.4b", "ATCRA"),
    ("2.0", "ATAMC"),
    ("2.1", "ATCTM1"),
];

/// Versions in release order.
pub const VERSIONS: &[&str] = &["1.0", "1.1", "1.2", "1.3", "1.4", "1.4b", "2.0", "2.1"];

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProbeResult {
    Accepted,
    /// Answered `?`: the adapter does not know the command.
    Rejected,
    NoAnswer,
}

#[derive(Debug, Clone, Serialize)]
pub struct Probe {
    pub version: &'static str,
    pub command: &'static str,
    pub result: ProbeResult,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdapterReport {
    /// Version the adapter claims (`1.5` from `ELM327 v1.5`), if any.
    pub claimed: Option<String>,
    /// Highest version whose commands (and all older ones) mostly work.
    pub real: Option<&'static str>,
    pub probes: Vec<Probe>,
    /// Claims more than it does: a clone that may fail on less common tasks.
    pub overclaims: bool,
}

/// `"ELM327 v1.5"` → `"1.5"`.
pub fn claimed_version(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    // First "v" followed by a digit: skips words like "device" or "obdii vlink".
    let start = lower
        .char_indices()
        .zip(lower.chars().skip(1))
        .find(|((_, c), next)| *c == 'v' && next.is_ascii_digit())?
        .0
        .0
        + 1;
    let v: String = lower[start..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '.')
        .collect();
    v.chars()
        .next()
        .is_some_and(|c| c.is_ascii_digit())
        .then_some(v)
}

fn rank(v: &str) -> usize {
    VERSIONS.iter().position(|x| *x == v).unwrap_or_else(|| {
        // Unknown text such as "1.5" or "2.2": same level as the
        // closest lower known version.
        let num = |s: &str| s.trim_end_matches('b').parse::<f64>().unwrap_or(0.0);
        VERSIONS.iter().rposition(|x| num(x) <= num(v)).unwrap_or(0)
    })
}

/// Real version: walk the versions in order while at least 3 of 4
/// commands of each one are accepted.
pub fn evaluate(claimed: Option<String>, probes: Vec<Probe>) -> AdapterReport {
    let mut real = None;
    for v in VERSIONS {
        let mine: Vec<&Probe> = probes.iter().filter(|p| p.version == *v).collect();
        let ok = mine
            .iter()
            .filter(|p| p.result == ProbeResult::Accepted)
            .count();
        if mine.is_empty() || ok * 4 < mine.len() * 3 {
            break;
        }
        real = Some(*v);
    }
    let overclaims = match (&claimed, real) {
        (Some(c), Some(r)) => rank(c) > rank(r),
        (Some(_), None) => true,
        _ => false,
    };
    AdapterReport {
        claimed,
        real,
        probes,
        overclaims,
    }
}

/// Runs every probe, then resets and reconfigures the adapter.
pub fn test_adapter(elm: &mut Elm327) -> Result<AdapterReport> {
    let mut probes = Vec::new();
    for (version, command) in PROBES {
        let result = match elm.raw_command(command, std::time::Duration::from_millis(1_500)) {
            Ok(raw) => {
                let lines = clean_lines(&raw, command);
                // Silence, "?" or an error line all mean the command was not
                // really understood.
                let rejected = lines.iter().all(|l| l.trim().is_empty())
                    || lines.iter().any(|l| {
                        let t = l.trim().to_ascii_uppercase();
                        t == "?" || t.contains("ERR")
                    });
                if rejected {
                    ProbeResult::Rejected
                } else {
                    ProbeResult::Accepted
                }
            }
            Err(crate::ObdError::Timeout) => ProbeResult::NoAnswer,
            Err(e) => return Err(e),
        };
        probes.push(Probe {
            version,
            command,
            result,
        });
    }
    let claimed = claimed_version(&elm.info.version);
    // Some probes changed settings: put everything back.
    let restored = elm.reconfigure();
    let report = evaluate(claimed, probes);
    match restored {
        Ok(()) => Ok(report),
        // The adapter is fine; the car may simply be off.
        Err(e) if !matches!(e, crate::ObdError::Io(_) | crate::ObdError::Connection(_)) => {
            Ok(report)
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probes(up_to: &str) -> Vec<Probe> {
        let limit = rank(up_to);
        PROBES
            .iter()
            .map(|(version, command)| Probe {
                version,
                command,
                result: if rank(version) <= limit {
                    ProbeResult::Accepted
                } else {
                    ProbeResult::Rejected
                },
            })
            .collect()
    }

    #[test]
    fn reads_the_claimed_version() {
        assert_eq!(claimed_version("ELM327 v1.5").as_deref(), Some("1.5"));
        assert_eq!(claimed_version("ELM327 v2.1").as_deref(), Some("2.1"));
        assert_eq!(claimed_version("OBDII"), None);
        assert_eq!(
            claimed_version("Vgate iCar ELM327 v2.1").as_deref(),
            Some("2.1")
        );
    }

    #[test]
    fn genuine_adapter_matches_its_claim() {
        let r = evaluate(Some("2.1".into()), probes("2.1"));
        assert_eq!(r.real, Some("2.1"));
        assert!(!r.overclaims);
    }

    #[test]
    fn clone_claiming_more_is_flagged() {
        let r = evaluate(Some("2.1".into()), probes("1.3"));
        assert_eq!(r.real, Some("1.3"));
        assert!(r.overclaims);
        // "v1.5" never existed: a clone that behaves as 1.4b is still honest enough.
        let r = evaluate(Some("1.5".into()), probes("1.4b"));
        assert!(!r.overclaims);
        let r = evaluate(Some("1.5".into()), probes("1.2"));
        assert!(r.overclaims);
    }

    #[test]
    fn one_missing_command_is_tolerated() {
        let mut p = probes("2.1");
        p.iter_mut().find(|x| x.command == "ATIGN").unwrap().result = ProbeResult::Rejected;
        assert_eq!(evaluate(None, p).real, Some("2.1"));
    }
}
