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

fn clean_group_part(part: &str) -> String {
  part
    .trim()
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
        ch
      } else {
        '-'
      }
    })
    .collect()
}

pub fn normalize_group_key(input: &str) -> String {
  let raw = input.trim();
  let source = if raw.is_empty() { TOP_LEVEL } else { raw };
  let parts: Vec<String> = source
    .split('.')
    .map(clean_group_part)
    .filter(|part| !part.is_empty())
    .collect();

  if parts.is_empty() {
    TOP_LEVEL.to_string()
  } else {
    parts.join(".")
  }
}
