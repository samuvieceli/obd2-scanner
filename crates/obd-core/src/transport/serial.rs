//! Serial transport: USB cables and Bluetooth classic (SPP) adapters.
//! On Windows a paired Bluetooth classic adapter shows up as a COM port
//! ("Standard Serial over Bluetooth link"), so the same code serves both.

use std::io::{ErrorKind, Read, Write};
use std::time::Duration;

use serialport::{SerialPort, SerialPortType};

use super::{PortInfo, Transport};
use crate::{ObdError, Result};

pub struct SerialTransport {
    port: Box<dyn SerialPort>,
    label: String,
}

impl SerialTransport {
    pub fn open(name: &str, baud_rate: u32) -> Result<Self> {
        let port = serialport::new(name, baud_rate)
            .timeout(Duration::from_millis(50))
            .open()
            .map_err(|e| ObdError::Connection(format!("{name}: {e}")))?;
        Ok(Self {
            port,
            label: format!("{name} @ {baud_rate}"),
        })
    }
}

impl Transport for SerialTransport {
    fn write_all(&mut self, data: &[u8]) -> Result<()> {
        self.port.write_all(data)?;
        self.port.flush()?;
        Ok(())
    }

    fn read(&mut self, buf: &mut [u8], timeout: Duration) -> Result<usize> {
        self.port
            .set_timeout(timeout.max(Duration::from_millis(1)))
            .map_err(|e| ObdError::Connection(e.to_string()))?;
        match self.port.read(buf) {
            Ok(n) => Ok(n),
            Err(e) if matches!(e.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => Ok(0),
            Err(e) => Err(e.into()),
        }
    }

    fn clear_input(&mut self) -> Result<()> {
        self.port
            .clear(serialport::ClearBuffer::Input)
            .map_err(|e| ObdError::Connection(e.to_string()))
    }

    fn describe(&self) -> String {
        self.label.clone()
    }
}

/// List serial ports, marking which ones look like Bluetooth or USB.
pub fn list_ports() -> Vec<PortInfo> {
    let Ok(ports) = serialport::available_ports() else {
        return Vec::new();
    };
    ports
        .into_iter()
        .map(|p| {
            let (kind, description) = match &p.port_type {
                SerialPortType::UsbPort(usb) => (
                    "usb",
                    [usb.manufacturer.clone(), usb.product.clone()]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
                SerialPortType::BluetoothPort => ("bluetooth", String::new()),
                SerialPortType::PciPort => ("pci", String::new()),
                SerialPortType::Unknown => ("unknown", String::new()),
            };
            PortInfo {
                name: p.port_name,
                kind: kind.into(),
                description,
            }
        })
        .collect()
}

/// Quickly finds the speed an ELM327 answers at: sends two harmless DEL
/// characters plus CR (never repeats a previous command) and waits briefly for
/// the `>` prompt. Much faster than a full `ATZ` per speed.
/// Technique from python-OBD / pyOBD (GPL-2.0-or-later).
pub fn probe_baud_rate(name: &str, rates: &[u32]) -> Option<u32> {
    let mut port = serialport::new(name, rates.first().copied().unwrap_or(38_400))
        .timeout(Duration::from_millis(50))
        .open()
        .ok()?;
    for &rate in rates {
        if port.set_baud_rate(rate).is_err() {
            continue;
        }
        let _ = port.clear(serialport::ClearBuffer::All);
        if port.write_all(b"\x7F\x7F\r").is_err() {
            continue;
        }
        let _ = port.flush();
        let deadline = std::time::Instant::now() + Duration::from_millis(400);
        let mut got = Vec::new();
        let mut buf = [0u8; 256];
        while std::time::Instant::now() < deadline {
            match port.read(&mut buf) {
                Ok(n) if n > 0 => {
                    got.extend_from_slice(&buf[..n]);
                    if got.contains(&b'>') {
                        return Some(rate);
                    }
                }
                _ => {}
            }
        }
        if String::from_utf8_lossy(&got)
            .to_ascii_uppercase()
            .contains("ELM")
        {
            return Some(rate);
        }
    }
    None
}
