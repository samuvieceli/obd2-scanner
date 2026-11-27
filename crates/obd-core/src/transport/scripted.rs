//! A transport that replays canned answers. Used by tests to reproduce the
//! exact byte streams sent by real (and quirky) adapters.

use std::collections::VecDeque;
use std::time::Duration;

use super::Transport;
use crate::Result;

/// Each expected command (without `\r`) is paired with the raw reply bytes.
/// Commands that are not in the script get `?\r\r>`.
#[derive(Default)]
pub struct ScriptedTransport {
    script: VecDeque<(String, String)>,
    pending: Vec<u8>,
    out: VecDeque<u8>,
    /// Every command received, in order.
    pub sent: Vec<String>,
}

impl ScriptedTransport {
    pub fn new() -> Self {
        Self::default()
    }

    /// Queue an answer for `command` (compared ignoring case and spaces).
    pub fn expect(mut self, command: &str, reply: &str) -> Self {
        self.script
            .push_back((normalize(command), reply.to_string()));
        self
    }
}

fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase()
}

impl Transport for ScriptedTransport {
    fn write_all(&mut self, data: &[u8]) -> Result<()> {
        self.pending.extend_from_slice(data);
        while let Some(pos) = self.pending.iter().position(|&b| b == b'\r') {
            let cmd: Vec<u8> = self.pending.drain(..=pos).collect();
            let cmd = normalize(&String::from_utf8_lossy(&cmd));
            self.sent.push(cmd.clone());
            let reply = match self.script.iter().position(|(c, _)| *c == cmd) {
                Some(i) => self.script.remove(i).map(|(_, r)| r).unwrap_or_default(),
                None => "?\r\r>".to_string(),
            };
            self.out.extend(reply.bytes());
        }
        Ok(())
    }

    fn read(&mut self, buf: &mut [u8], _timeout: Duration) -> Result<usize> {
        let n = buf.len().min(self.out.len());
        for (i, b) in self.out.drain(..n).enumerate() {
            buf[i] = b;
        }
        Ok(n)
    }

    fn describe(&self) -> String {
        "scripted".into()
    }
}
