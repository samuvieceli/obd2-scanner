use thiserror::Error;

/// Every error the core can produce. Messages are in English; the UI maps the
/// [`ObdError::code`] to a translated text.
#[derive(Debug, Error)]
pub enum ObdError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("the adapter did not answer in time")]
    Timeout,
    #[error("the vehicle returned no data for this request")]
    NoData,
    #[error("the adapter could not talk to the vehicle (ignition off or unsupported protocol)")]
    UnableToConnect,
    #[error("the adapter did not understand the command")]
    UnknownCommand,
    #[error("bus error reported by the adapter: {0}")]
    Bus(String),
    #[error("the ECU rejected the request (negative response 0x{0:02X})")]
    NegativeResponse(u8),
    #[error("could not parse the adapter response: {0}")]
    Parse(String),
    #[error("not connected")]
    NotConnected,
    #[error("connection error: {0}")]
    Connection(String),
    #[error("the adapter restarted by itself (voltage dip or crash) and lost its settings")]
    AdapterReset,
    /// The program refused to send the request; the text is the reason code
    /// (e.g. `engine_running`).
    #[error("request refused: {0}")]
    Refused(&'static str),
    /// A port could not be opened, with a known reason (code such as
    /// `port_busy`) and the system's own message.
    #[error("{1}")]
    Port(&'static str, String),
}

impl ObdError {
    /// Stable machine-readable code, used by the UI for translations.
    pub fn code(&self) -> &'static str {
        match self {
            ObdError::Io(_) => "io",
            ObdError::Timeout => "timeout",
            ObdError::NoData => "no_data",
            ObdError::UnableToConnect => "unable_to_connect",
            ObdError::UnknownCommand => "unknown_command",
            ObdError::Bus(_) => "bus",
            ObdError::NegativeResponse(_) => "negative_response",
            ObdError::Parse(_) => "parse",
            ObdError::NotConnected => "not_connected",
            ObdError::Connection(_) => "connection",
            ObdError::AdapterReset => "adapter_reset",
            ObdError::Refused(code) => code,
            ObdError::Port(code, _) => code,
        }
    }
}

pub type Result<T> = std::result::Result<T, ObdError>;
