//! Wi-Fi ELM327 adapters expose a plain TCP socket (often 192.168.0.10:35000).

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use super::Transport;
use crate::{ObdError, Result};

pub struct TcpTransport {
    stream: TcpStream,
    label: String,
}

impl TcpTransport {
    pub fn connect(host: &str, port: u16, timeout: Duration) -> Result<Self> {
        let addr = (host, port)
            .to_socket_addrs()
            .map_err(|e| ObdError::Connection(format!("{host}:{port}: {e}")))?
            .next()
            .ok_or_else(|| ObdError::Connection(format!("{host}:{port}: address not found")))?;
        let stream = TcpStream::connect_timeout(&addr, timeout)
            .map_err(|e| ObdError::Connection(format!("{host}:{port}: {e}")))?;
        stream.set_nodelay(true)?;
        Ok(Self {
            stream,
            label: format!("Wi-Fi {host}:{port}"),
        })
    }
}

impl Transport for TcpTransport {
    fn write_all(&mut self, data: &[u8]) -> Result<()> {
        self.stream.write_all(data)?;
        self.stream.flush()?;
        Ok(())
    }

    fn read(&mut self, buf: &mut [u8], timeout: Duration) -> Result<usize> {
        self.stream
            .set_read_timeout(Some(timeout.max(Duration::from_millis(1))))?;
        match self.stream.read(buf) {
            Ok(0) => Err(ObdError::Connection(
                "the adapter closed the connection".into(),
            )),
            Ok(n) => Ok(n),
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => Ok(0),
            Err(e) => Err(e.into()),
        }
    }

    /// Drops only what already arrived, without waiting for more.
    fn clear_input(&mut self) -> Result<()> {
        self.stream.set_nonblocking(true)?;
        let mut buf = [0u8; 256];
        let result = loop {
            match self.stream.read(&mut buf) {
                Ok(0) => {
                    break Err(ObdError::Connection(
                        "the adapter closed the connection".into(),
                    ));
                }
                Ok(_) => continue,
                Err(e) if e.kind() == ErrorKind::WouldBlock => break Ok(()),
                Err(e) => break Err(e.into()),
            }
        };
        self.stream.set_nonblocking(false)?;
        result
    }

    fn describe(&self) -> String {
        self.label.clone()
    }
}
