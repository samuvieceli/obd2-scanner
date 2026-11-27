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
