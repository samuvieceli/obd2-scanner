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

pub mod dtc;
pub mod elm327;
pub mod error;
pub mod interpret;
pub mod mode06;
pub mod pid;
pub mod readiness;
pub mod response;
pub mod session;
pub mod simulator;
pub mod transport;
pub mod vin;

pub use error::{ObdError, Result};
