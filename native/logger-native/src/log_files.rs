use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use regex::Regex;
use serde_json::Value as JsonValue;
use walkdir::WalkDir;

use crate::common::{PARTITION_MARKER_FILE, TOP_LEVEL};

pub struct ParsedLogFile {
  pub day: String,
  pub hour: String,
  pub minute: String,
  pub second: String,
  pub sequence: u64,
  pub level: String,
  pub compressed: bool,
}

pub struct PartitionFileEntry {
  pub abs_path: PathBuf,
  pub file_name: String,
  pub rel_dir: String,
  pub parsed: ParsedLogFile,
}

pub fn parse_log_name(file_name: &str) -> Option<ParsedLogFile> {
  let regex = Regex::new(r"^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d+)-([a-z0-9._-]+)\.jsonl(\.gz)?$").ok()?;
  let captures = regex.captures(file_name)?;
  Some(ParsedLogFile {
    day: captures.get(1)?.as_str().to_string(),
    hour: captures.get(2)?.as_str().to_string(),
    minute: captures.get(3)?.as_str().to_string(),
    second: captures.get(4)?.as_str().to_string(),
    sequence: captures
      .get(5)?
      .as_str()
      .parse::<u64>()
      .ok()
      .unwrap_or(0),
    level: captures.get(6)?.as_str().to_string(),
    compressed: captures.get(7).is_some(),
  })
}

pub fn count_rows(file_path: &Path, compressed: bool) -> std::io::Result<u64> {
  if compressed {
    let file = File::open(file_path)?;
    let decoder = GzDecoder::new(file);
    let reader = BufReader::new(decoder);
    let mut count = 0_u64;
    for line in reader.lines() {
      if !line?.trim().is_empty() {
        count += 1;
      }
    }
    return Ok(count);
  }

  let file = File::open(file_path)?;
  let reader = BufReader::new(file);
  let mut count = 0_u64;
  for line in reader.lines() {
    if !line?.trim().is_empty() {
      count += 1;
    }
  }
  Ok(count)
}

pub fn group_key_from_dir(rel_dir: &str) -> String {
  let trimmed = rel_dir.trim_matches('/');
  if trimmed.is_empty() {
    return TOP_LEVEL.to_string();
  }
  trimmed.split('/').filter(|part| !part.is_empty()).collect::<Vec<_>>().join(".")
}

pub fn collect_partition_files(root: &Path) -> Vec<PartitionFileEntry> {
  let mut files = Vec::new();

  for entry in WalkDir::new(root).into_iter().filter_map(|entry| entry.ok()) {
    if !entry.file_type().is_file() {
      continue;
    }
    if entry.file_name().to_string_lossy() == PARTITION_MARKER_FILE {
      continue;
    }

    let file_name = entry.file_name().to_string_lossy().to_string();
    let Some(parsed) = parse_log_name(&file_name) else {
      continue;
    };

    let abs_path = entry.path().to_path_buf();
    let rel_parent = abs_path
      .parent()
      .and_then(|parent| parent.strip_prefix(root).ok())
      .unwrap_or_else(|| Path::new(""));
    let rel_dir = rel_parent.to_string_lossy().replace('\\', "/");

    files.push(PartitionFileEntry {
      abs_path,
      file_name,
      rel_dir,
      parsed,
    });
  }

  files.sort_by(|a, b| a.abs_path.cmp(&b.abs_path));
  files
}

pub fn logical_partition_path(partition: &str, rel_dir: &str, file_name: &str) -> String {
  if rel_dir.is_empty() {
    format!("{partition}/{file_name}")
  } else {
    format!("{partition}/{rel_dir}/{file_name}")
  }
}

pub fn find_available_target_path(dir: &Path, file: &PartitionFileEntry) -> PathBuf {
  let mut sequence = file.parsed.sequence;

  loop {
    let file_name = format!(
      "{}-{}-{}-{}-{:04}-{}.jsonl",
      file.parsed.day,
      file.parsed.hour,
      file.parsed.minute,
      file.parsed.second,
      sequence,
      file.parsed.level
    );
    let plain_target = dir.join(&file_name);
    let gzip_target = dir.join(format!("{file_name}.gz"));
    if !plain_target.exists() && !gzip_target.exists() {
      return if file.parsed.compressed {
        gzip_target
      } else {
        plain_target
      };
    }
    sequence += 1;
  }
}

pub fn read_jsonl_rows(file_path: &Path, compressed: bool) -> std::io::Result<Vec<JsonValue>> {
  let mut rows = Vec::new();

  if compressed {
    let file = File::open(file_path)?;
    let decoder = GzDecoder::new(file);
    let reader = BufReader::new(decoder);

    for line in reader.lines() {
      let line = line?;
      if line.trim().is_empty() {
        continue;
      }
      if let Ok(JsonValue::Object(object)) = serde_json::from_str::<JsonValue>(&line) {
        rows.push(JsonValue::Object(object));
      }
    }

    return Ok(rows);
  }

  let file = File::open(file_path)?;
  let reader = BufReader::new(file);
  for line in reader.lines() {
    let line = line?;
    if line.trim().is_empty() {
      continue;
    }
    if let Ok(JsonValue::Object(object)) = serde_json::from_str::<JsonValue>(&line) {
      rows.push(JsonValue::Object(object));
    }
  }

  Ok(rows)
}

pub fn write_jsonl_rows(file_path: &Path, rows: &[JsonValue], compressed: bool) -> std::io::Result<()> {
  let payload = if rows.is_empty() {
    String::new()
  } else {
    let mut lines = rows
      .iter()
      .map(|row| serde_json::to_string(row))
      .collect::<std::result::Result<Vec<_>, _>>()
      .map_err(std::io::Error::other)?
      .join("\n");
    lines.push('\n');
    lines
  };

  if compressed {
    let file = File::create(file_path)?;
    let mut encoder = GzEncoder::new(file, Compression::default());
    encoder.write_all(payload.as_bytes())?;
    encoder.finish()?;
    return Ok(());
  }

  fs::write(file_path, payload)
}
