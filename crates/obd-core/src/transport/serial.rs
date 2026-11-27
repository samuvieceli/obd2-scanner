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
/// On Windows the Bluetooth ports are told apart (see [`super::bt_ports`]):
/// outgoing ones, which work, come first with the adapter's name; incoming
/// ones (`bluetooth_in`) go last.
pub fn list_ports() -> Vec<PortInfo> {
    let Ok(ports) = serialport::available_ports() else {
        return Vec::new();
    };
    let bt = super::bt_ports::bluetooth_ports();
    let mut list: Vec<PortInfo> = ports
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
            let known = bt
                .iter()
                .find(|b| b.port.eq_ignore_ascii_case(&p.port_name));
            let kind = match known {
                Some(b) if b.incoming => "bluetooth_in",
                Some(_) => "bluetooth",
                None => kind,
            };
            PortInfo {
                name: p.port_name,
                kind: kind.into(),
                description: known.and_then(|b| b.device.clone()).unwrap_or(description),
            }
        })
        .collect();
    list.sort_by_key(|p| match p.kind.as_str() {
        "bluetooth" => 0,
        "usb" => 1,
        "bluetooth_in" => 3,
        _ => 2,
    });
    list
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

/// What identifies a USB adapter whatever COM number Windows gives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsbIdentity {
    pub vid: u16,
    pub pid: u16,
    /// Missing on many cheap clones (CH340 chips have none).
    pub serial_number: Option<String>,
}

fn usb_ports() -> Vec<(String, UsbIdentity)> {
    serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| match p.port_type {
            SerialPortType::UsbPort(u) => Some((
                p.port_name,
                UsbIdentity {
                    vid: u.vid,
                    pid: u.pid,
                    serial_number: u.serial_number.filter(|s| !s.trim().is_empty()),
                },
            )),
            _ => None,
        })
        .collect()
}

/// The USB identity of `port`, if it is a USB adapter plugged in now.
pub fn usb_identity(port: &str) -> Option<UsbIdentity> {
    usb_ports()
        .into_iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(port))
        .map(|(_, id)| id)
}

/// The port where the same USB adapter is now (after unplugging it, Windows
/// may give it another COM number).
pub fn find_usb_port(id: &UsbIdentity) -> Option<String> {
    pick_usb_port(id, &usb_ports())
}

/// Same serial number; without one, the same chip (vendor and product ids)
/// only when exactly one such port exists, so two identical clones are
/// never mixed up.
fn pick_usb_port(id: &UsbIdentity, ports: &[(String, UsbIdentity)]) -> Option<String> {
    if id.serial_number.is_some() {
        return ports
            .iter()
            .find(|(_, p)| p == id)
            .map(|(name, _)| name.clone());
    }
    let mut same_chip = ports
        .iter()
        .filter(|(_, p)| p.vid == id.vid && p.pid == id.pid);
    match (same_chip.next(), same_chip.next()) {
        (Some((name, _)), None) => Some(name.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usb(vid: u16, pid: u16, serial: Option<&str>) -> UsbIdentity {
        UsbIdentity {
            vid,
            pid,
            serial_number: serial.map(String::from),
        }
    }

    #[test]
    fn finds_the_adapter_on_its_new_com_port() {
        let ftdi = usb(0x0403, 0x6001, Some("A50285BI"));
        let ports = vec![
            ("COM3".to_string(), usb(0x0403, 0x6001, Some("OTHER"))),
            ("COM7".to_string(), ftdi.clone()),
        ];
        assert_eq!(pick_usb_port(&ftdi, &ports).as_deref(), Some("COM7"));
        assert_eq!(pick_usb_port(&ftdi, &ports[..1]), None);
    }

    #[test]
    fn clones_without_serial_number_only_when_unambiguous() {
        let ch340 = usb(0x1A86, 0x7523, None);
        let one = vec![("COM5".to_string(), ch340.clone())];
        assert_eq!(pick_usb_port(&ch340, &one).as_deref(), Some("COM5"));
        let two = vec![
            ("COM5".to_string(), ch340.clone()),
            ("COM6".to_string(), ch340.clone()),
        ];
        assert_eq!(pick_usb_port(&ch340, &two), None);
    }
}
