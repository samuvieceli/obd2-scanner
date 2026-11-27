//! Link health: notices when the adapter freezes and decides what to do.
//!
//! Cheap ELM327 clones sometimes lock up during long sessions: they stop
//! answering, answer only `STOPPED`/`BUFFER FULL`, or reset themselves after a
//! voltage dip (engine cranking) and lose their settings. A real ELM327 almost
//! never does this, which is why ordinary programs simply stop showing data.
//!
//! [`LinkHealth`] watches the outcome of every request and says when a
//! recovery is due; [`reconnect_delay`] gives the waiting time between
//! reconnection attempts when the link itself is gone (Bluetooth out of
//! range, adapter unplugged). The recovery steps live in
//! [`crate::elm327::Elm327::recover`] and in the app's connection worker.

use std::time::Duration;

use crate::ObdError;

/// What one request told us about the adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Valid data, `NO DATA` or an ECU refusal: the adapter works.
    Answered,
    /// Silence, bus error words or garbage: maybe frozen.
    Suspicious,
    /// The adapter printed its start-up banner or `LV RESET`: it rebooted and
    /// lost its settings.
    AdapterReset,
    /// The link itself broke (port closed, Bluetooth dropped).
    LinkLost,
}

impl Outcome {
    pub fn of<T>(r: &Result<T, ObdError>) -> Self {
        match r {
            Ok(_) => Outcome::Answered,
            Err(e) => Self::of_error(e),
        }
    }

    pub fn of_error(e: &ObdError) -> Self {
        match e {
            ObdError::NoData
            | ObdError::NegativeResponse(_)
            | ObdError::UnknownCommand
            | ObdError::UnableToConnect
            | ObdError::Refused(_) => Outcome::Answered,
            ObdError::Timeout | ObdError::Bus(_) | ObdError::Parse(_) => Outcome::Suspicious,
            ObdError::AdapterReset => Outcome::AdapterReset,
            ObdError::Io(_)
            | ObdError::Connection(_)
            | ObdError::Port(..)
            | ObdError::NotConnected => Outcome::LinkLost,
        }
    }
}

/// What the connection worker should do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Continue,
    /// Reset and reconfigure the adapter (see `Elm327::recover`).
    Recover,
    /// Close the port and open it again.
    Reconnect,
}

/// Consecutive suspicious requests before a recovery. Each request was
/// already retried once, so 3 means about 6 failed exchanges in a row.
pub const SUSPICIOUS_LIMIT: u32 = 3;

/// Counts suspicious requests in a row.
#[derive(Debug, Default)]
pub struct LinkHealth {
    streak: u32,
}

impl LinkHealth {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&mut self, outcome: Outcome) -> Action {
        match outcome {
            Outcome::Answered => {
                self.streak = 0;
                Action::Continue
            }
            Outcome::Suspicious => {
                self.streak += 1;
                if self.streak >= SUSPICIOUS_LIMIT {
                    self.streak = 0;
                    Action::Recover
                } else {
                    Action::Continue
                }
            }
            Outcome::AdapterReset => {
                self.streak = 0;
                Action::Recover
            }
            Outcome::LinkLost => {
                self.streak = 0;
                Action::Reconnect
            }
        }
    }

    pub fn reset(&mut self) {
        self.streak = 0;
    }
}

/// Wait before reconnection attempt `attempt` (1-based): quick at first,
/// then every 10 s so a Bluetooth adapter has time to come back.
pub fn reconnect_delay(attempt: u32) -> Duration {
    const STEPS: [u64; 5] = [1, 2, 3, 5, 8];
    let secs = STEPS
        .get(attempt.saturating_sub(1) as usize)
        .copied()
        .unwrap_or(10);
    Duration::from_secs(secs)
}

/// Total time spent trying to reconnect before giving up.
pub const RECONNECT_GIVE_UP: Duration = Duration::from_secs(180);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_keep_the_link_healthy() {
        let mut h = LinkHealth::new();
        for _ in 0..10 {
            assert_eq!(h.record(Outcome::Suspicious), Action::Continue);
            assert_eq!(h.record(Outcome::Answered), Action::Continue);
        }
    }

    #[test]
    fn three_suspicious_requests_in_a_row_trigger_recovery() {
        let mut h = LinkHealth::new();
        assert_eq!(h.record(Outcome::Suspicious), Action::Continue);
        assert_eq!(h.record(Outcome::Suspicious), Action::Continue);
        assert_eq!(h.record(Outcome::Suspicious), Action::Recover);
        // Counting starts again after a recovery.
        assert_eq!(h.record(Outcome::Suspicious), Action::Continue);
    }

    #[test]
    fn reset_and_lost_link_act_immediately() {
        let mut h = LinkHealth::new();
        assert_eq!(h.record(Outcome::AdapterReset), Action::Recover);
        assert_eq!(h.record(Outcome::LinkLost), Action::Reconnect);
    }

    #[test]
    fn errors_are_classified() {
        assert_eq!(Outcome::of_error(&ObdError::NoData), Outcome::Answered);
        assert_eq!(Outcome::of_error(&ObdError::Timeout), Outcome::Suspicious);
        assert_eq!(
            Outcome::of_error(&ObdError::Bus("STOPPED".into())),
            Outcome::Suspicious
        );
        assert_eq!(
            Outcome::of_error(&ObdError::Connection("x".into())),
            Outcome::LinkLost
        );
    }

    #[test]
    fn reconnect_delay_backs_off() {
        assert_eq!(reconnect_delay(1), Duration::from_secs(1));
        assert_eq!(reconnect_delay(5), Duration::from_secs(8));
        assert_eq!(reconnect_delay(50), Duration::from_secs(10));
    }
}
