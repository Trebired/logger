use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use napi::Result;
use serde::Serialize;

use crate::common::{bytes_to_megabytes, err, to_iso_time, PARTITION_MARKER_FILE};
use crate::log_files::{collect_partition_files, count_rows, group_key_from_dir, logical_partition_path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanTotals {
  logs: u64,
  dirs: u64,
  files: u64,
  bytes: u64,
  megabytes: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanPartition {
  name: String,
  total: ScanTotals,
  last_activity_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanFile {
  abs_path: String,
  path: String,
  partition: String,
  group_key: String,
  day: String,
  hour: String,
  level: String,
  compressed: bool,
  bytes: u64,
  rows: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanSummaryTotals {
  partitions: u64,
  files: u64,
  logs: u64,
  bytes: u64,
  megabytes: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanSnapshot {
  partitions: Vec<ScanPartition>,
  files: Vec<ScanFile>,
  total: ScanSummaryTotals,
}

fn scan_single_partition(base_dir: &Path, partition: &str) -> Result<(ScanPartition, Vec<ScanFile>)> {
  let root = base_dir.join(partition);
  if !root.join(PARTITION_MARKER_FILE).exists() {
    return Err(err(format!("partition-not-found: {partition}")));
  }

  let mut files: Vec<ScanFile> = Vec::new();
  let mut dirs = BTreeSet::new();
  let mut bytes = 0_u64;
  let mut logs = 0_u64;
  let mut last_activity: Option<SystemTime> = None;

  for file in collect_partition_files(&root).into_iter() {
    let logical_path = logical_partition_path(partition, &file.rel_dir, &file.file_name);
    let metadata = fs::metadata(&file.abs_path).map_err(|error| err(error.to_string()))?;
    let row_count = count_rows(&file.abs_path, file.parsed.compressed).map_err(|error| err(error.to_string()))?;
    bytes += metadata.len();
    logs += row_count;
    dirs.insert(if file.rel_dir.is_empty() { ".".to_string() } else { file.rel_dir.clone() });
    if let Ok(modified) = metadata.modified() {
      if last_activity.map(|current| modified > current).unwrap_or(true) {
        last_activity = Some(modified);
      }
    }

    files.push(ScanFile {
      abs_path: file.abs_path.to_string_lossy().to_string(),
      path: logical_path,
      partition: partition.to_string(),
      group_key: group_key_from_dir(&file.rel_dir),
      day: file.parsed.day,
      hour: file.parsed.hour,
      level: file.parsed.level,
      compressed: file.parsed.compressed,
      bytes: metadata.len(),
      rows: row_count,
    });
  }

  files.sort_by(|a, b| a.path.cmp(&b.path));

  Ok((
    ScanPartition {
      name: partition.to_string(),
      total: ScanTotals {
        logs,
        dirs: dirs.len() as u64,
        files: files.len() as u64,
        bytes,
        megabytes: bytes_to_megabytes(bytes),
      },
      last_activity_at: last_activity.map(to_iso_time),
    },
    files,
  ))
}

pub fn scan_partitions_json(dir: String, partitions: Vec<String>) -> Result<String> {
  let base_dir = PathBuf::from(dir);
  if partitions.is_empty() {
    let snapshot = ScanSnapshot {
      partitions: Vec::new(),
      files: Vec::new(),
      total: ScanSummaryTotals {
        partitions: 0,
        files: 0,
        logs: 0,
        bytes: 0,
        megabytes: 0.0,
      },
    };
    return serde_json::to_string(&snapshot).map_err(|error| err(error.to_string()));
  }

  let mut partition_items = Vec::new();
  let mut file_items = Vec::new();

  let mut names = partitions;
  names.sort();
  names.dedup();

  for partition in names.iter() {
    let (item, mut files) = scan_single_partition(&base_dir, partition)?;
    partition_items.push(item);
    file_items.append(&mut files);
  }

  file_items.sort_by(|a, b| a.path.cmp(&b.path));

  let total_bytes: u64 = file_items.iter().map(|item| item.bytes).sum();
  let total = ScanSummaryTotals {
    partitions: partition_items.len() as u64,
    files: file_items.len() as u64,
    logs: file_items.iter().map(|item| item.rows).sum(),
    bytes: total_bytes,
    megabytes: bytes_to_megabytes(total_bytes),
  };

  serde_json::to_string(&ScanSnapshot {
    partitions: partition_items,
    files: file_items,
    total,
  })
  .map_err(|error| err(error.to_string()))
}
