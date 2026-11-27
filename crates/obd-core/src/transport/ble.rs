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

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError};
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
/// Serial-like services with long ids, also seen on OBD adapters: Vgate
/// vLinker, Nordic UART and Microchip/ISSC transparent UART.
const KNOWN_LONG_SERVICES: [u128; 3] = [
    0xE7810A71_73AE_499D_8C15_FAA9AEF0C3F2,
    0x6E400001_B5A3_F393_E0A9_E50E24DCCA9E,
    0x49535343_FE7D_4AE5_8FA9_9FAFD205E455,
];
/// Standard services that never carry adapter data.
const IGNORED_SERVICES: [u16; 4] = [0x1800, 0x1801, 0x180A, 0x180F];
/// Firmware update services (Nordic DFU, Nordic legacy DFU, TI OAD): they
/// also have write and notify characteristics, and writing OBD commands
/// there must never happen.
const FIRMWARE_UPDATE_SERVICES: [u128; 3] = [
    0x0000FE59_0000_1000_8000_00805F9B34FB,
    0x00001530_1212_EFDE_1523_785FEABCD123,
    0xF000FFC0_0451_4000_B000_000000000000,
];
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
    let ignored: Vec<u128> = IGNORED_SERVICES
        .iter()
        .map(|&u| uuid_from_u16(u).as_u128())
        .chain(FIRMWARE_UPDATE_SERVICES)
        .collect();
    let usable: Vec<&Characteristic> = chars
        .iter()
        .filter(|c| !ignored.contains(&c.service_uuid.as_u128()))
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
    let mut services: Vec<_> = KNOWN_SERVICES
        .iter()
        .map(|&u| uuid_from_u16(u))
        .chain(
            KNOWN_LONG_SERVICES
                .iter()
                .map(|&u| uuid::Uuid::from_u128(u)),
        )
        .collect();
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
        let n = in_svc().find(|c| can_notify(c))?;
        // FFF0 adapters answer on FFF1 and listen on FFF2; some clones mark
        // FFF1 writable too, but commands written there are ignored. Prefer
        // a writable characteristic other than the one that answers; use the
        // same one only when it is the only choice (FFE0/FFE1 adapters).
        let w = in_svc()
            .find(|c| can_write(c) && c.uuid != n.uuid)
            .or_else(|| in_svc().find(|c| can_write(c)))?;
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
            let sent = self.rt.block_on(self.peripheral.write(
                &self.write_char,
                chunk,
                self.write_type,
            ));
            if let Err(e) = sent {
                // Some adapters announce "write without response" but only
                // accept the confirmed kind (seen on Windows): switch once.
                let can_confirm = self.write_type == WriteType::WithoutResponse
                    && self.write_char.properties.contains(CharPropFlags::WRITE);
                if !can_confirm {
                    return Err(err(e));
                }
                self.write_type = WriteType::WithResponse;
                self.rt
                    .block_on(
                        self.peripheral
                            .write(&self.write_char, chunk, self.write_type),
                    )
                    .map_err(err)?;
            }
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

    /// Drops the answers already received, without waiting for more.
    fn clear_input(&mut self) -> Result<()> {
        self.pending.clear();
        loop {
            match self.rx.try_recv() {
                Ok(_) => {}
                Err(TryRecvError::Empty) => return Ok(()),
                Err(TryRecvError::Disconnected) => return Err(err("the adapter disconnected")),
            }
        }
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
    fn writes_to_fff2_even_when_fff1_is_writable_too() {
        let chars = vec![
            ch(0xFFF0, 0xFFF1, CharPropFlags::NOTIFY | CharPropFlags::WRITE),
            ch(0xFFF0, 0xFFF2, CharPropFlags::WRITE_WITHOUT_RESPONSE),
        ];
        let (w, n) = pick_characteristics(&chars).unwrap();
        assert_eq!(w.uuid, uuid_from_u16(0xFFF2));
        assert_eq!(n.uuid, uuid_from_u16(0xFFF1));
    }

    #[test]
    fn never_picks_a_firmware_update_service() {
        let dfu = |uuid: u128, props| Characteristic {
            uuid: uuid::Uuid::from_u128(uuid),
            service_uuid: uuid::Uuid::from_u128(0x0000FE59_0000_1000_8000_00805F9B34FB),
            properties: props,
            descriptors: BTreeSet::new(),
        };
        let only_dfu = vec![dfu(
            0x8EC90001_F315_4F60_9FB8_838830DAEA50,
            CharPropFlags::WRITE | CharPropFlags::NOTIFY,
        )];
        assert!(pick_characteristics(&only_dfu).is_none());
    }

    #[test]
    fn finds_the_vlinker_service() {
        let svc = 0xE7810A71_73AE_499D_8C15_FAA9AEF0C3F2;
        let c = Characteristic {
            uuid: uuid::Uuid::from_u128(0xBEF8D6C9_9C21_4C9E_B632_BD58C1009F9F),
            service_uuid: uuid::Uuid::from_u128(svc),
            properties: CharPropFlags::WRITE | CharPropFlags::NOTIFY,
            descriptors: BTreeSet::new(),
        };
        let other = ch(0xABCD, 0x1234, CharPropFlags::WRITE | CharPropFlags::NOTIFY);
        let (w, _) = pick_characteristics(&[other, c.clone()]).unwrap();
        assert_eq!(w.uuid, c.uuid);
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
