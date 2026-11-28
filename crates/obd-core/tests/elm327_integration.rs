//! End-to-end tests of the ELM327 driver against the simulator (normal and
//! clone-like) and against scripted byte streams from real-world adapters.

use obd_core::ObdError;
use obd_core::dtc::Dtc;
use obd_core::elm327::{Elm327, ElmConfig};
use obd_core::readiness::MonitorState;
use obd_core::simulator::{DEMO_VIN, Simulator, SimulatorOptions};
use obd_core::transport::scripted::ScriptedTransport;
use obd_core::vin::decode_vin;

fn fast_config() -> ElmConfig {
    ElmConfig {
        command_timeout_ms: 300,
        reset_timeout_ms: 500,
        search_timeout_ms: 500,
        ..Default::default()
    }
}

fn demo(quirky: bool) -> Elm327 {
    let sim = Simulator::new(SimulatorOptions {
        quirky,
        ..Default::default()
    });
    let mut elm = Elm327::new(Box::new(sim), fast_config());
    elm.initialize().expect("initialize");
    elm
}

#[test]
fn full_session_against_simulator() {
    for quirky in [false, true] {
        let mut elm = demo(quirky);
        assert!(
            elm.info.version.contains("ELM327"),
            "version: {}",
            elm.info.version
        );
        assert!(elm.info.is_can());
        assert!(elm.info.supported_pids.contains(&0x0C));
        assert!(elm.info.supported_pids.contains(&0x5C), "range 0x40 read");

        let rpm = elm.read_pid(0x0C).unwrap().value;
        assert!(rpm > 500.0 && rpm < 3000.0, "rpm {rpm}");
        let v = elm.battery_voltage().unwrap();
        assert!(v > 13.0 && v < 15.0);

        let stored = elm.read_stored_dtcs().unwrap();
        assert_eq!(stored, vec![Dtc("P0301".into()), Dtc("P0420".into())]);
        assert_eq!(elm.read_pending_dtcs().unwrap(), vec![Dtc("P0171".into())]);
        assert_eq!(
            elm.read_permanent_dtcs().unwrap(),
            vec![Dtc("P0420".into())]
        );

        let ident = elm.read_vehicle_identity();
        assert_eq!(ident.vin.as_deref(), Some(DEMO_VIN));
        assert_eq!(ident.calibration_id.as_deref(), Some("SIMCAL-0001"));
        assert_eq!(ident.obd_standard, Some(0x1D));
        assert_eq!(ident.fuel_type, Some(0x09));
        // Brazilian VIN: position 9 is not a check digit, so it is not judged.
        assert_eq!(decode_vin(DEMO_VIN, 2026).check_digit_ok, None);

        assert_eq!(
            elm.read_freeze_frame_dtc().unwrap(),
            Some(Dtc("P0301".into()))
        );
        assert_eq!(elm.read_freeze_frame_pid(0x0C).unwrap().value, 2350.0);

        let r = elm.read_readiness().unwrap();
        assert!(r.mil_on);
        assert_eq!(r.dtc_count, 2);

        // Engine running: clearing is refused and the codes stay.
        assert!(matches!(
            elm.clear_dtcs(),
            Err(ObdError::Refused("engine_running"))
        ));
        assert_eq!(elm.read_stored_dtcs().unwrap().len(), 2);
        elm.command("ATSIMOFF").unwrap();
        elm.clear_dtcs().unwrap();
        assert!(elm.read_stored_dtcs().unwrap().is_empty());
        let r = elm.read_readiness().unwrap();
        assert!(!r.mil_on);
        assert!(
            r.monitors
                .iter()
                .any(|m| m.state == MonitorState::Incomplete)
        );
        assert!(matches!(
            elm.read_freeze_frame_pid(0x0C),
            Err(ObdError::NoData)
        ));
    }
}

#[test]
fn clone_with_echo_no_ok_and_searching() {
    // A typical cheap clone: echo cannot be disabled, no OK after ATL0,
    // "SEARCHING..." before the first answer, lowercase-free, no spaces.
    let t = ScriptedTransport::new()
        .expect("ATI", "ELM327 v1.5\r\r>")
        .expect("ATZ", "ATZ\r\r\rELM327 v2.1\r\r>")
        .expect("ATE0", "ATE0\rOK\r\r>")
        .expect("ATL0", "ATL0\r\r>")
        .expect("ATS1", "ATS1\rOK\r\r>")
        .expect("ATH0", "ATH0\rOK\r\r>")
        .expect("ATAT1", "ATAT1\r?\r\r>")
        .expect("ATI", "ATI\rELM327 v2.1\r\r>")
        .expect("ATSP0", "ATSP0\rOK\r\r>")
        .expect("0100", "0100\rSEARCHING...\r4100BE3EB811\r\r>")
        .expect("ATDPN", "ATDPN\rA6\r\r>")
        .expect("ATDP", "ATDP\rAUTO, ISO 15765-4 (CAN 11/500)\r\r>")
        .expect("0120", "0120\r4120A007B011\r\r>")
        .expect("010C", "010C\r\x00410C0FA0\r\r>")
        .expect("03", "03\r43020133042000\r\r>");
    let mut elm = Elm327::new(Box::new(t), fast_config());
    elm.initialize().unwrap();
    assert_eq!(elm.info.version, "ELM327 v2.1");
    assert!(elm.info.supported_pids.contains(&0x0C));
    assert_eq!(elm.read_pid(0x0C).unwrap().value, 1000.0);
    assert_eq!(
        elm.read_stored_dtcs().unwrap(),
        vec![Dtc("P0133".into()), Dtc("P0420".into())]
    );
}

#[test]
fn ignition_off_reports_unable_to_connect() {
    let t = ScriptedTransport::new()
        .expect("ATZ", "\r\rELM327 v1.5\r\r>")
        .expect("ATE0", "OK\r\r>")
        .expect("ATL0", "OK\r\r>")
        .expect("ATS1", "OK\r\r>")
        .expect("ATH0", "OK\r\r>")
        .expect("ATAT1", "OK\r\r>")
        .expect("ATI", "ELM327 v1.5\r\r>")
        .expect("ATSP0", "OK\r\r>")
        .expect("0100", "SEARCHING...\rUNABLE TO CONNECT\r\r>");
    let mut elm = Elm327::new(Box::new(t), fast_config());
    elm.setup_adapter().unwrap();
    assert!(matches!(
        elm.connect_vehicle(),
        Err(ObdError::UnableToConnect)
    ));
}

#[test]
fn legacy_protocol_dtcs_and_multi_ecu() {
    // ISO 9141-2 car: DTCs padded with zeros, two ECUs answer 0100.
    let t = ScriptedTransport::new()
        .expect("ATZ", "ELM327 v1.4b\r\r>")
        .expect("ATI", "ELM327 v1.4b\r\r>")
        .expect(
            "0100",
            "BUS INIT: ...OK\r41 00 BE 1F A8 13\r41 00 80 00 00 00\r\r>",
        )
        .expect("ATDPN", "A3\r\r>")
        .expect("ATDP", "AUTO, ISO 9141-2\r\r>")
        .expect("0120", "NO DATA\r\r>")
        .expect("03", "43 01 33 00 00 00 00\r\r>");
    let mut elm = Elm327::new(Box::new(t), fast_config());
    elm.initialize().unwrap();
    assert!(!elm.info.is_can());
    assert_eq!(elm.read_stored_dtcs().unwrap(), vec![Dtc("P0133".into())]);
}

#[test]
fn falls_back_to_trying_protocols_one_by_one() {
    // Auto search fails, protocol 8 (CAN 11/250) works.
    let t = ScriptedTransport::new()
        .expect("ATZ", "ELM327 v1.5\r\r>")
        .expect("ATI", "ELM327 v1.5\r\r>")
        .expect("0100", "SEARCHING...\rUNABLE TO CONNECT\r\r>")
        .expect("ATTP6", "OK\r\r>")
        .expect("0100", "CAN ERROR\r\r>")
        .expect("ATTP8", "OK\r\r>")
        .expect("0100", "41 00 BE 1F A8 13\r\r>")
        .expect("ATDPN", "8\r\r>")
        .expect("ATDP", "ISO 15765-4 (CAN 11/250)\r\r>")
        .expect("0120", "NO DATA\r\r>");
    let mut elm = Elm327::new(Box::new(t), fast_config());
    elm.initialize().unwrap();
    assert_eq!(elm.info.protocol_number, "8");
    assert!(elm.info.supported_pids.contains(&0x0C));
}

#[test]
fn multi_pid_request_against_simulator() {
    let mut elm = demo(false);
    let values = elm
        .read_pids_multi(&[0x0C, 0x0D, 0x05, 0x14, 0x10, 0x99])
        .unwrap();
    let keys: Vec<&str> = values.iter().map(|v| v.0.as_str()).collect();
    assert_eq!(keys, vec!["rpm", "speed", "coolant_temp", "o2_b1s1", "maf"]);
}

#[test]
fn multi_pid_parses_real_can_answer() {
    // Answer to "010C0D05" from a CAN car: one multi-frame message.
    let t = ScriptedTransport::new().expect(
        "010C0D05",
        "00A\r0: 41 0C 0F A0 0D 32\r1: 05 7B 00 00 00 00 00\r\r>",
    );
    let mut elm = Elm327::new(Box::new(t), fast_config());
    let v = elm.read_pids_multi(&[0x0C, 0x0D, 0x05]).unwrap();
    assert_eq!(
        v.iter().map(|x| x.1).collect::<Vec<_>>(),
        vec![1000.0, 50.0, 83.0]
    );
}

#[test]
fn reads_high_range_pids_and_odometer() {
    let mut elm = demo(false);
    assert!(
        elm.info.supported_pids.contains(&0xA6),
        "ranges 0x60-0xA0 followed"
    );
    let v = elm.read_pid_values(0xA6).unwrap();
    assert_eq!(v[0].0, "odometer");
    assert!(v[0].1 > 48_000.0);
}

#[test]
fn reads_mode06_test_results() {
    for quirky in [false, true] {
        let mut elm = demo(quirky);
        let results = elm.read_mode06().expect("mode 06");
        assert!(results.len() >= 12, "got {}", results.len());
        let cat = results.iter().find(|r| r.mid == 0x21).expect("catalyst");
        assert!(!cat.passed, "catalyst should fail like P0420");
        let cyl1 = results
            .iter()
            .find(|r| r.mid == 0xA2 && r.tid == 0x0C)
            .unwrap();
        assert!(!cyl1.passed);
        let o2 = results
            .iter()
            .find(|r| r.mid == 0x01 && r.tid == 0x01)
            .unwrap();
        assert_eq!(o2.unit, "mV");
        assert!(o2.passed);
    }
}

#[test]
fn retries_after_stopped_and_buffer_full() {
    // A clone interrupts the first answer, then answers correctly.
    let t = ScriptedTransport::new()
        .expect("010C", "STOPPED\r\r>")
        .expect("010C", "41 0C 0F A0\r\r>")
        .expect("010D", "41 0D 3\rBUFFER FULL\r\r>")
        .expect("010D", "41 0D 32\r\r>");
    let mut elm = Elm327::new(Box::new(t), fast_config());
    assert_eq!(elm.read_pid(0x0C).unwrap().value, 1000.0);
    assert_eq!(elm.read_pid(0x0D).unwrap().value, 50.0);
}

#[test]
fn records_rejected_at_commands_and_clone_version() {
    let t = ScriptedTransport::new()
        .expect("ATI", "ELM327 v1.5\r\r>")
        .expect("ATZ", "\r\rELM327 v2.1\r\r>")
        .expect("ATE0", "ATE0\rOK\r\r>")
        .expect("ATL0", "OK\r\r>")
        .expect("ATS1", "?\r\r>")
        .expect("ATH0", "OK\r\r>")
        .expect("ATAT1", "?\r\r>")
        .expect("ATI", "ELM327 v2.1\r\r>")
        .expect("ATSP0", "OK\r\r>");
    let mut elm = Elm327::new(Box::new(t), fast_config());
    elm.setup_adapter().unwrap();
    assert!(elm.info.likely_clone);
    assert_eq!(elm.info.unsupported_at, vec!["ATS1", "ATAT1"]);
}

#[test]
fn recovers_from_a_frozen_clone() {
    use obd_core::health::{Action, LinkHealth, Outcome};
    let mut elm = demo(true);
    elm.raw_command("ATSIMHANG", std::time::Duration::from_millis(300))
        .unwrap();
    // The worker would see three silent requests in a row and recover.
    let mut health = LinkHealth::new();
    let mut action = Action::Continue;
    for _ in 0..3 {
        let r = elm.read_pid(0x0C);
        assert!(matches!(r, Err(ObdError::Timeout)), "{r:?}");
        action = health.record(Outcome::of(&r));
    }
    assert_eq!(action, Action::Recover);
    elm.recover().expect("recover");
    assert!(elm.read_pid(0x0C).is_ok());
    assert!(!elm.link_lost());
}

#[test]
fn notices_an_adapter_that_rebooted() {
    let mut elm = demo(false);
    elm.raw_command("ATSIMRESET", std::time::Duration::from_millis(300))
        .unwrap();
    assert!(matches!(elm.read_pid(0x0D), Err(ObdError::AdapterReset)));
    elm.recover().expect("recover");
    assert!(elm.read_pid(0x0D).is_ok());
}

#[test]
fn fully_frozen_adapter_needs_a_reconnection() {
    let mut elm = demo(false);
    elm.raw_command("ATSIMFREEZE", std::time::Duration::from_millis(300))
        .unwrap();
    assert!(matches!(elm.recover(), Err(ObdError::Connection(_))));
}

#[test]
fn dropped_link_is_flagged() {
    let mut elm = demo(false);
    elm.raw_command("ATSIMDROP", std::time::Duration::from_millis(300))
        .unwrap();
    assert!(matches!(elm.read_pid(0x0C), Err(ObdError::Io(_))));
    assert!(elm.link_lost());
}

#[test]
fn adapter_test_tells_the_real_version() {
    use obd_core::adapter_test::test_adapter;
    let mut elm = demo(false);
    let r = test_adapter(&mut elm).unwrap();
    assert_eq!(r.claimed.as_deref(), Some("1.5"));
    assert_eq!(r.real, Some("1.4b"));
    assert!(!r.overclaims);
    // Settings are back: reading still works.
    assert!(elm.read_pid(0x0C).is_ok());

    let mut elm = demo(true);
    let r = test_adapter(&mut elm).unwrap();
    assert_eq!(r.real, Some("1.1"));
    assert!(r.overclaims);
    assert!(elm.read_pid(0x0C).is_ok());
}

#[test]
fn ecu_scan_finds_engine_and_transmission() {
    use obd_core::ecu_scan::scan_ecus;
    for quirky in [false, true] {
        let mut elm = demo(quirky);
        let ecus = scan_ecus(&mut elm).unwrap();
        assert_eq!(ecus.len(), 2, "{ecus:?}");
        let engine = &ecus[0];
        assert_eq!((engine.address.as_str(), engine.role), ("7E8", "engine"));
        assert_eq!(engine.name.as_deref(), Some("ECM-EngineControl"));
        let id = |k: &str| {
            engine
                .ids
                .iter()
                .find(|i| i.key == k)
                .map(|i| i.value.clone())
        };
        assert_eq!(id("vin").as_deref(), Some(DEMO_VIN));
        assert_eq!(id("software_version").as_deref(), Some("SW 0102"));
        assert_eq!(id("serial_number"), None);
        let tcm = &ecus[1];
        assert_eq!((tcm.address.as_str(), tcm.role), ("7E9", "transmission"));
        assert_eq!(tcm.supported_pids, 4);
        assert_eq!(tcm.name.as_deref(), Some("TCM-Transmission"));
        assert!(tcm.ids.is_empty());
        // Headers are off again and requests go to every unit.
        assert!(elm.read_pid(0x0C).is_ok());
        assert_eq!(elm.read_vehicle_identity().vin.as_deref(), Some(DEMO_VIN));
    }
}

#[test]
fn speed_zero_without_rpm_is_not_engine_off() {
    // Idling at a traffic light, RPM not answered: never "stopped".
    let t = ScriptedTransport::new()
        .expect("010C", "010C\rNO DATA\r\r>")
        .expect("010D", "010D\r41 0D 00\r\r>");
    let mut elm = Elm327::new(Box::new(t), fast_config());
    assert!(matches!(
        elm.engine_running(),
        Err(ObdError::Refused("engine_unknown"))
    ));
}

#[test]
fn clear_needs_a_confirmation_from_a_unit() {
    let stopped = |reply: &str| {
        ScriptedTransport::new()
            .expect("010C", "010C\r41 0C 00 00\r\r>")
            .expect("010D", "010D\r41 0D 00\r\r>")
            .expect("04", reply)
    };
    let mut elm = Elm327::new(Box::new(stopped("04\rOK\r\r>")), fast_config());
    assert!(elm.clear_dtcs().is_err());
    let mut elm = Elm327::new(Box::new(stopped("04\r44\r\r>")), fast_config());
    assert!(elm.clear_dtcs().is_ok());
    let mut elm = Elm327::new(Box::new(stopped("04\r7F 04 22\r\r>")), fast_config());
    assert!(matches!(
        elm.clear_dtcs(),
        Err(ObdError::NegativeResponse(0x22))
    ));
}

#[test]
fn manufacturer_parameters_against_simulator() {
    use obd_core::maker;
    for quirky in [false, true] {
        let mut elm = demo(quirky);
        let keys: Vec<String> = [
            "mfr_corolla_eot",
            "mfr_corolla_vvtot",
            "mfr_corolla_prev_trip_dst",
        ]
        .iter()
        .map(|k| k.to_string())
        .collect();
        let request = maker::request_of(&keys[0]).unwrap();
        assert_eq!(maker::request_of(&keys[1]), Some(request));
        let got = maker::read(&mut elm, request, &keys).expect("manufacturer read");
        let value = |k: &str| got.iter().find(|(key, _)| key == k).map(|(_, v)| *v);
        let oil = value("mfr_corolla_eot").unwrap();
        assert!((-40.0..=215.0).contains(&oil), "{oil}");
        assert_eq!(value("mfr_corolla_prev_trip_dst"), Some(12.34));

        // Transmission fluid: another request to the same unit.
        let atf = ["mfr_corolla_atf_pan_t".to_string()];
        let got = maker::read(&mut elm, maker::request_of(&atf[0]).unwrap(), &atf).unwrap();
        assert_eq!(got.len(), 1);

        // Standard requests go back to every unit afterwards.
        elm.read_pid(0x0C).expect("rpm after manufacturer read");
        let ecus = obd_core::ecu_scan::scan_ecus(&mut elm).expect("scan");
        assert_eq!(ecus.len(), 2, "quirky={quirky}");
    }
}

#[test]
fn manufacturer_request_needs_can_and_a_read_service() {
    use obd_core::elm327::Addressing;
    let mut elm = demo(false);
    let to = Addressing {
        header: "7E0".into(),
        receive: "7E8".into(),
        flow_control: false,
    };
    // Writing services are refused before anything is sent.
    assert!(matches!(
        elm.read_manufacturer(&to, 0x2E, &[0x01, 0x02]),
        Err(ObdError::Refused("blocked_write"))
    ));
    // An identifier the unit does not know: a refusal, not a link problem.
    assert!(matches!(
        elm.read_manufacturer(&to, 0x21, &[0x99]),
        Err(ObdError::NegativeResponse(0x31))
    ));
}
