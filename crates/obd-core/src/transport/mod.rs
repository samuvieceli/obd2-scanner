//! Transport layer: one small trait, many backends.
//!
//! Everything above this layer (ELM327 protocol, decoders, UI) does not know
//! whether bytes travel over a USB cable, a Bluetooth COM port, Wi-Fi or the
//! simulator. Adding a backend means implementing [`Transport`].

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::Result;

#[cfg(feature = "ble")]
pub mod ble;
pub mod scripted;
#[cfg(feature = "serial")]
pub mod serial;
pub mod tcp;

/// A byte pipe to an ELM327 adapter.
pub trait Transport: Send {
    /// Send all bytes.
    fn write_all(&mut self, data: &[u8]) -> Result<()>;

    /// Read whatever is available, waiting at most `timeout`.
    /// Returns `Ok(0)` when nothing arrived in time (this is not an error).
    fn read(&mut self, buf: &mut [u8], timeout: Duration) -> Result<usize>;

    /// Drop any stale bytes waiting in the input buffer.
    fn clear_input(&mut self) -> Result<()> {
        let mut buf = [0u8; 256];
        while self.read(&mut buf, Duration::from_millis(5))? > 0 {}
        Ok(())
    }

    /// Human readable description (e.g. `COM5 @ 38400`).
    fn describe(&self) -> String;
}

/// How to reach the adapter. Serialized as JSON between UI and backend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectionTarget {
    /// USB cable or Bluetooth classic (SPP) adapter, both appear as a COM port.
    /// `baud_rate = 0` means "try the common speeds automatically".
    Serial { port: String, baud_rate: u32 },
    /// Wi-Fi adapter (usually 192.168.0.10:35000).
    Tcp { host: String, port: u16 },
    /// Bluetooth Low Energy adapter, `id` from a BLE scan.
    Ble { id: String, name: String },
    /// Built-in virtual car, no hardware needed.
    Demo,
}

/// Common ELM327 baud rates, most likely first.
pub const COMMON_BAUD_RATES: [u32; 5] = [38_400, 9_600, 115_200, 57_600, 230_400];

/// Information about a serial port found on this computer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortInfo {
    pub name: String,
    /// `usb`, `bluetooth`, `pci` or `unknown`.
    pub kind: String,
    pub description: String,
}
