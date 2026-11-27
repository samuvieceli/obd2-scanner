//! Bluetooth Low Energy (BLE) adapters, common in models made for iPhone
//! (Vgate iCar Pro BLE, Veepeak BLE, OBDLink CX, many "V-LINK" clones).
//!
//! BLE has no serial port: the adapter exposes a GATT *service* with one
//! characteristic we write commands to and one that *notifies* answers.
//! Vendors use different UUIDs, so we pick them by their properties and
//! prefer the services known from popular adapters.
//!
//! btleplug is asynchronous; this transport owns a small Tokio runtime and
//! exposes the same blocking [`Transport`] interface as every other backend.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use btleplug::api::bleuuid::uuid_from_u16;
use btleplug::api::{
    Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::runtime::Runtime;

use super::Transport;
use crate::{ObdError, Result};

/// Services used by popular ELM327 BLE adapters, most common first.
const KNOWN_SERVICES: [u16; 3] = [0xFFF0, 0xFFE0, 0x18F0];
/// Standard services that never carry adapter data.
const IGNORED_SERVICES: [u16; 4] = [0x1800, 0x1801, 0x180A, 0x180F];
/// Conservative write size: fits the default BLE MTU (23 bytes − 3).
const CHUNK: usize = 20;

/// A BLE device found by [`scan`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BleDevice {
    /// Platform identifier (Bluetooth address on Windows).
    pub id: String,
    pub name: String,
    /// Signal strength in dBm, when known.
    pub rssi: Option<i16>,
    /// The name looks like an OBD adapter.
    pub likely_obd: bool,
}

fn err(e: impl std::fmt::Display) -> ObdError {
    ObdError::Connection(format!("Bluetooth LE: {e}"))
}

fn runtime() -> Result<Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .map_err(err)
}

async fn first_adapter() -> Result<Adapter> {
    let manager = Manager::new().await.map_err(err)?;
    manager
        .adapters()
        .await
        .map_err(err)?
        .into_iter()
        .next()
        .ok_or_else(|| err("no Bluetooth adapter found on this computer"))
}

fn looks_like_obd(name: &str) -> bool {
    let n = name.to_ascii_uppercase();
    [
        "OBD",
        "ELM",
        "VLINK",
        "V-LINK",
        "VGATE",
        "ICAR",
        "VEEPEAK",
        "KONNWEI",
        "CARISTA",
        "IOS-VLINK",
    ]
    .iter()
    .any(|k| n.contains(k))
}

async fn describe(p: &Peripheral) -> Option<BleDevice> {
    let props = p.properties().await.ok().flatten()?;
    let name = props.local_name.unwrap_or_default();
    Some(BleDevice {
        id: p.id().to_string(),
        likely_obd: looks_like_obd(&name),
        name,
        rssi: props.rssi,
    })
}

/// Scans for nearby BLE devices for `duration`. Likely OBD adapters first.
pub fn scan(duration: Duration) -> Result<Vec<BleDevice>> {
    runtime()?.block_on(async {
        let adapter = first_adapter().await?;
        adapter
            .start_scan(ScanFilter::default())
            .await
            .map_err(err)?;
        tokio::time::sleep(duration).await;
        let _ = adapter.stop_scan().await;
        let mut out = Vec::new();
        for p in adapter.peripherals().await.map_err(err)? {
            if let Some(d) = describe(&p).await {
                out.push(d);
            }
        }
        out.sort_by(|a, b| {
            (b.likely_obd, !b.name.is_empty(), b.rssi.unwrap_or(-127)).cmp(&(
                a.likely_obd,
                !a.name.is_empty(),
                a.rssi.unwrap_or(-127),
            ))
        });
        Ok(out)
    })
}

/// Chooses the (write, notify) characteristic pair of an adapter.
pub fn pick_characteristics(chars: &[Characteristic]) -> Option<(Characteristic, Characteristic)> {
    let ignored: Vec<_> = IGNORED_SERVICES.iter().map(|&u| uuid_from_u16(u)).collect();
    let usable: Vec<&Characteristic> = chars
        .iter()
        .filter(|c| !ignored.contains(&c.service_uuid))
        .collect();
    let can_write = |c: &Characteristic| {
        c.properties
            .intersects(CharPropFlags::WRITE | CharPropFlags::WRITE_WITHOUT_RESPONSE)
    };
    let can_notify = |c: &Characteristic| {
        c.properties
            .intersects(CharPropFlags::NOTIFY | CharPropFlags::INDICATE)
    };
    // Services in preference order: known ones, then any other.
    let mut services: Vec<_> = KNOWN_SERVICES.iter().map(|&u| uuid_from_u16(u)).collect();
    for c in &usable {
        if !services.contains(&c.service_uuid) {
            services.push(c.service_uuid);
        }
    }
    services.into_iter().find_map(|svc| {
        let in_svc = || {
            usable
                .iter()
                .copied()
                .filter(move |c| c.service_uuid == svc)
        };
        let w = in_svc().find(|c| can_write(c))?;
        let n = in_svc().find(|c| can_notify(c))?;
        Some((w.clone(), n.clone()))
    })
}

pub struct BleTransport {
    rt: Runtime,
    peripheral: Peripheral,
    write_char: Characteristic,
    write_type: WriteType,
    rx: Receiver<Vec<u8>>,
    pending: Vec<u8>,
    label: String,
}

impl BleTransport {
    /// Connects to the device with this `id` (from [`scan`]).
    pub fn open(id: &str, name: &str) -> Result<Self> {
        let rt = runtime()?;
        let (peripheral, write_char, notify_char, stream) = rt.block_on(async {
            let adapter = first_adapter().await?;
            adapter
                .start_scan(ScanFilter::default())
                .await
                .map_err(err)?;
            // The device must be seen by this adapter instance before connecting.
            let deadline = Instant::now() + Duration::from_secs(8);
            let peripheral = loop {
                let found = adapter
                    .peripherals()
                    .await
                    .map_err(err)?
                    .into_iter()
                    .find(|p| p.id().to_string() == id);
                if let Some(p) = found {
                    break p;
                }
                if Instant::now() > deadline {
                    let _ = adapter.stop_scan().await;
                    return Err(err(format!(
                        "device \"{name}\" not found; is it powered and nearby?"
                    )));
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            };
            let _ = adapter.stop_scan().await;
            peripheral.connect().await.map_err(err)?;
            peripheral.discover_services().await.map_err(err)?;
            let chars: Vec<Characteristic> = peripheral.characteristics().into_iter().collect();
            let (w, n) = pick_characteristics(&chars).ok_or_else(|| {
                err("this device does not look like an OBD adapter (no serial-like service)")
            })?;
            // Listen before subscribing: btleplug drops notifications that
            // arrive while nobody holds a stream, so the first answer of a
            // fast adapter could otherwise be lost.
            let stream = peripheral.notifications().await.map_err(err)?;
            peripheral.subscribe(&n).await.map_err(err)?;
            Ok::<_, ObdError>((peripheral, w, n, stream))
        })?;

        let (tx, rx) = mpsc::channel();
        let notify_uuid = notify_char.uuid;
        rt.spawn(async move {
            let mut stream = stream;
            while let Some(n) = stream.next().await {
                if n.uuid == notify_uuid && tx.send(n.value).is_err() {
                    break;
                }
            }
        });
        let write_type = if write_char
            .properties
            .contains(CharPropFlags::WRITE_WITHOUT_RESPONSE)
        {
            WriteType::WithoutResponse
        } else {
            WriteType::WithResponse
        };
        Ok(Self {
            rt,
            peripheral,
            write_char,
            write_type,
            rx,
            pending: Vec::new(),
            label: format!("BLE {}", if name.is_empty() { id } else { name }),
        })
    }
}

impl Transport for BleTransport {
    fn write_all(&mut self, data: &[u8]) -> Result<()> {
        for chunk in data.chunks(CHUNK) {
            self.rt
                .block_on(
                    self.peripheral
                        .write(&self.write_char, chunk, self.write_type),
                )
                .map_err(err)?;
        }
        Ok(())
    }

    fn read(&mut self, buf: &mut [u8], timeout: Duration) -> Result<usize> {
        if self.pending.is_empty() {
            match self.rx.recv_timeout(timeout) {
                Ok(v) => self.pending = v,
                Err(RecvTimeoutError::Timeout) => return Ok(0),
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(err("the adapter disconnected"));
                }
            }
        }
        let n = self.pending.len().min(buf.len());
        buf[..n].copy_from_slice(&self.pending[..n]);
        self.pending.drain(..n);
        Ok(n)
    }

    fn describe(&self) -> String {
        self.label.clone()
    }
}

impl Drop for BleTransport {
    fn drop(&mut self) {
        let _ = self.rt.block_on(self.peripheral.disconnect());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn ch(service: u16, uuid: u16, props: CharPropFlags) -> Characteristic {
        Characteristic {
            uuid: uuid_from_u16(uuid),
            service_uuid: uuid_from_u16(service),
            properties: props,
            descriptors: BTreeSet::new(),
        }
    }

    #[test]
    fn picks_fff0_pair_and_skips_standard_services() {
        let chars = vec![
            ch(0x180A, 0x2A29, CharPropFlags::READ),
            ch(0x1801, 0x2A05, CharPropFlags::INDICATE),
            ch(0xFFF0, 0xFFF1, CharPropFlags::NOTIFY),
            ch(0xFFF0, 0xFFF2, CharPropFlags::WRITE),
        ];
        let (w, n) = pick_characteristics(&chars).unwrap();
        assert_eq!(w.uuid, uuid_from_u16(0xFFF2));
        assert_eq!(n.uuid, uuid_from_u16(0xFFF1));
    }

    #[test]
    fn single_characteristic_for_both_directions() {
        let chars = vec![ch(
            0xFFE0,
            0xFFE1,
            CharPropFlags::NOTIFY | CharPropFlags::WRITE_WITHOUT_RESPONSE,
        )];
        let (w, n) = pick_characteristics(&chars).unwrap();
        assert_eq!(w.uuid, n.uuid);
    }

    #[test]
    fn names() {
        assert!(looks_like_obd("IOS-Vlink"));
        assert!(looks_like_obd("OBDII"));
        assert!(!looks_like_obd("Galaxy Buds"));
    }
}
