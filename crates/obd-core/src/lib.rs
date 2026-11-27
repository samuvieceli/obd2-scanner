//! # obd-core
//!
//! Núcleo do OBD2 Scanner, independente da interface gráfica.
//! Core of the OBD2 Scanner, independent from the user interface.
//!
//! Camadas / layers (de baixo para cima / bottom-up):
//!
//! 1. [`transport`]: move bytes to and from the adapter (serial/USB, Bluetooth
//!    classic via COM port, Wi-Fi TCP, the built-in [`simulator`]).
//! 2. [`elm327`]: speaks the ELM327 text protocol on top of any transport and is
//!    tolerant to clone quirks (echo, missing `OK`, `SEARCHING...`, NULL bytes).
//! 3. [`response`]: turns raw adapter text into OBD-II messages (incl. CAN
//!    ISO-TP multi-frame responses).
//! 4. Decoders: [`pid`], [`dtc`], [`vin`], [`readiness`], [`mode06`].
//! 5. [`interpret`]: plain-language findings from live data.
//! 6. [`session`]: recording and export (CSV, JSON).
//! 7. [`health`]: notices a frozen adapter or a lost link and says what to do.
//! 8. Tools: [`adapter_test`] (real ELM327 version of an adapter) and
//!    [`ecu_scan`] (control units on the bus and their identification).

pub mod adapter_test;
pub mod dtc;
pub mod ecu_scan;
pub mod elm327;
pub mod error;
pub mod health;
pub mod interpret;
pub mod mode06;
pub mod pid;
pub mod readiness;
pub mod report;
pub mod response;
pub mod safety;
pub mod session;
pub mod simulator;
pub mod transport;
pub mod vin;

pub use error::{ObdError, Result};
