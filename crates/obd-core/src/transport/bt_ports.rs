//! Which Bluetooth COM port is the right one (Windows).
//!
//! When a Bluetooth classic adapter is paired, Windows usually creates two
//! COM ports for it: an *outgoing* one, which the program opens to talk to the
//! adapter, and an *incoming* one, used only when the other device connects
//! to the computer. An ELM327 never does that, so the incoming port never
//! answers, and picking it is the most common Bluetooth mistake.
//!
//! Windows keeps both in the registry under `Enum\BTHENUM`: the instance name
//! of an outgoing port ends with the adapter's Bluetooth address
//! (`...&0&001DA568988B_C00000000`), an incoming one with zeros. The
//! address also leads to the name the adapter announces (`OBDII`, `V-LINK`).
//! Read-only: nothing is changed in the registry.

/// Bluetooth facts about one COM port.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BtPort {
    pub port: String,
    /// Incoming port: never answers, do not use.
    pub incoming: bool,
    /// Name the paired device announces, if known.
    pub device: Option<String>,
}

/// Bluetooth address (12 hex digits) in a BTHENUM instance name, or `None`
/// for an incoming port (address all zeros) or an unknown format.
pub fn address_of_instance(instance: &str) -> Option<String> {
    let last = instance.rsplit('&').next()?;
    let addr = last.split('_').next()?;
    let valid = addr.len() == 12 && addr.chars().all(|c| c.is_ascii_hexdigit());
    (valid && addr.chars().any(|c| c != '0')).then(|| addr.to_ascii_lowercase())
}

/// Serial Port Profile service id: the only Bluetooth service that becomes a
/// COM port.
#[cfg(windows)]
const SPP: &str = "{00001101-0000-1000-8000-00805f9b34fb}";

/// Every Bluetooth COM port Windows knows, with its direction and device name.
#[cfg(windows)]
pub fn bluetooth_ports() -> Vec<BtPort> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(bthenum) = hklm.open_subkey(r"SYSTEM\CurrentControlSet\Enum\BTHENUM") else {
        return Vec::new();
    };
    let devices = hklm
        .open_subkey(r"SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices")
        .ok();
    let name_of = |addr: &str| -> Option<String> {
        let raw = devices
            .as_ref()?
            .open_subkey(addr)
            .ok()?
            .get_raw_value("Name")
            .ok()?;
        let text = String::from_utf8_lossy(&raw.bytes);
        let name = text.trim_end_matches('\0').trim();
        (!name.is_empty()).then(|| name.to_string())
    };
    let mut out = Vec::new();
    for service in bthenum.enum_keys().flatten() {
        if !service.to_ascii_lowercase().starts_with(SPP) {
            continue;
        }
        let Ok(service_key) = bthenum.open_subkey(&service) else {
            continue;
        };
        for instance in service_key.enum_keys().flatten() {
            let port: Option<String> = service_key
                .open_subkey(format!(r"{instance}\Device Parameters"))
                .and_then(|k| k.get_value("PortName"))
                .ok();
            let Some(port) = port else { continue };
            let addr = address_of_instance(&instance);
            out.push(BtPort {
                port,
                incoming: addr.is_none(),
                device: addr.as_deref().and_then(name_of),
            });
        }
    }
    out
}

#[cfg(not(windows))]
pub fn bluetooth_ports() -> Vec<BtPort> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outgoing_ports_carry_the_device_address() {
        assert_eq!(
            address_of_instance("8&2C2A8E8B&0&001DA568988B_C00000000").as_deref(),
            Some("001da568988b")
        );
        assert_eq!(
            address_of_instance("7&1D86E73A&0&000000000000_00000000"),
            None
        );
        assert_eq!(address_of_instance("garbage"), None);
    }
}
