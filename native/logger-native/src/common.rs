use std::time::SystemTime;

use chrono::{DateTime, Utc};

pub const PARTITION_MARKER_FILE: &str = ".trebired-partition.json";
pub const TOP_LEVEL: &str = "top-level";

pub fn err(message: impl Into<String>) -> napi::Error {
  napi::Error::from_reason(message.into())
}

pub fn to_iso_time(value: SystemTime) -> String {
  let timestamp: DateTime<Utc> = value.into();
  timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn bytes_to_megabytes(bytes: u64) -> f64 {
  bytes as f64 / (1024_f64 * 1024_f64)
}
