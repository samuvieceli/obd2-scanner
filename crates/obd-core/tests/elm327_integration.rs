//! End-to-end tests of the ELM327 driver against the simulator (normal and
//! clone-like) and against scripted byte streams from real-world adapters.

use obd_core::dtc::Dtc;
use obd_core::elm327::{Elm327, ElmConfig};
use obd_core::readiness::MonitorState;
use obd_core::simulator::{Simulator, SimulatorOptions, DEMO_VIN};
use obd_core::transport::scripted::ScriptedTransport;
use obd_core::vin::decode_vin;
use obd_core::ObdError;

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
        assert_eq!(decode_vin(DEMO_VIN, 2026).check_digit_ok, Some(true));

        assert_eq!(
            elm.read_freeze_frame_dtc().unwrap(),
            Some(Dtc("P0301".into()))
        );
        assert_eq!(elm.read_freeze_frame_pid(0x0C).unwrap().value, 2350.0);

        let r = elm.read_readiness().unwrap();
        assert!(r.mil_on);
        assert_eq!(r.dtc_count, 2);

        elm.clear_dtcs().unwrap();
        assert!(elm.read_stored_dtcs().unwrap().is_empty());
        let r = elm.read_readiness().unwrap();
        assert!(!r.mil_on);
        assert!(r
            .monitors
            .iter()
            .any(|m| m.state == MonitorState::Incomplete));
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
        .expect("", "\r>")
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
        .expect("", "\r>")
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
