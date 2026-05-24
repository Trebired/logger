use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Utc};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use napi::Result;
use napi_derive::napi;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tar::Builder as TarBuilder;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const PARTITION_MARKER_FILE: &str = ".trebired-partition.json";
const TOP_LEVEL: &str = "top-level";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanTotals {
  logs: u64,
  dirs: u64,
  files: u64,
  bytes: u64,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanSnapshot {
  partitions: Vec<ScanPartition>,
  files: Vec<ScanFile>,
  total: ScanSummaryTotals,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveGeneratedFile {
  archive_path: String,
  content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveSourceFile {
  source_path: String,
  archive_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveCreateInput {
  output_path: String,
  format: String,
  root_name: String,
  overwrite: bool,
  generated_files: Vec<ArchiveGeneratedFile>,
  source_files: Vec<ArchiveSourceFile>,
}

fn err(message: impl Into<String>) -> napi::Error {
  napi::Error::from_reason(message.into())
}

fn to_iso_time(value: SystemTime) -> String {
  let timestamp: DateTime<Utc> = value.into();
  timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn parse_log_name(file_name: &str) -> Option<(String, String, String, bool)> {
  let regex = Regex::new(r"^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d+)-([a-z0-9._-]+)\.jsonl(\.gz)?$").ok()?;
  let captures = regex.captures(file_name)?;
  Some((
    captures.get(1)?.as_str().to_string(),
    captures.get(2)?.as_str().to_string(),
    captures.get(4)?.as_str().to_string(),
    captures.get(5).is_some(),
  ))
}

fn count_rows(file_path: &Path, compressed: bool) -> std::io::Result<u64> {
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

fn group_key_from_dir(rel_dir: &str) -> String {
  let trimmed = rel_dir.trim_matches('/');
  if trimmed.is_empty() {
    return TOP_LEVEL.to_string();
  }
  trimmed.split('/').filter(|part| !part.is_empty()).collect::<Vec<_>>().join(".")
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

  for entry in WalkDir::new(&root).into_iter().filter_map(|entry| entry.ok()) {
    if !entry.file_type().is_file() {
      continue;
    }
    if entry.file_name().to_string_lossy() == PARTITION_MARKER_FILE {
      continue;
    }

    let file_name = entry.file_name().to_string_lossy().to_string();
    let Some((day, hour, level, compressed)) = parse_log_name(&file_name) else {
      continue;
    };

    let abs_path = entry.path().to_path_buf();
    let rel_parent = abs_path
      .parent()
      .and_then(|parent| parent.strip_prefix(&root).ok())
      .unwrap_or_else(|| Path::new(""));
    let rel_dir = rel_parent.to_string_lossy().replace('\\', "/");
    let logical_path = if rel_dir.is_empty() {
      format!("{partition}/{file_name}")
    } else {
      format!("{partition}/{rel_dir}/{file_name}")
    };

    let metadata = fs::metadata(&abs_path).map_err(|error| err(error.to_string()))?;
    let row_count = count_rows(&abs_path, compressed).map_err(|error| err(error.to_string()))?;
    bytes += metadata.len();
    logs += row_count;
    dirs.insert(if rel_dir.is_empty() { ".".to_string() } else { rel_dir.clone() });
    if let Ok(modified) = metadata.modified() {
      if last_activity.map(|current| modified > current).unwrap_or(true) {
        last_activity = Some(modified);
      }
    }

    files.push(ScanFile {
      abs_path: abs_path.to_string_lossy().to_string(),
      path: logical_path,
      partition: partition.to_string(),
      group_key: group_key_from_dir(&rel_dir),
      day,
      hour,
      level,
      compressed,
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
      },
      last_activity_at: last_activity.map(to_iso_time),
    },
    files,
  ))
}

#[napi]
pub fn scan_partitions(dir: String, partitions: Vec<String>) -> Result<String> {
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

  let total = ScanSummaryTotals {
    partitions: partition_items.len() as u64,
    files: file_items.len() as u64,
    logs: file_items.iter().map(|item| item.rows).sum(),
    bytes: file_items.iter().map(|item| item.bytes).sum(),
  };

  serde_json::to_string(&ScanSnapshot {
    partitions: partition_items,
    files: file_items,
    total,
  })
  .map_err(|error| err(error.to_string()))
}

fn write_zip_archive(input: &ArchiveCreateInput) -> Result<()> {
  let file = File::create(&input.output_path).map_err(|error| err(error.to_string()))?;
  let mut writer = ZipWriter::new(file);
  let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

  let mut generated = input.generated_files.iter().collect::<Vec<_>>();
  generated.sort_by(|a, b| a.archive_path.cmp(&b.archive_path));
  for item in generated {
    writer
      .start_file(format!("{}/{}", input.root_name, item.archive_path), options)
      .map_err(|error| err(error.to_string()))?;
    writer
      .write_all(item.content.as_bytes())
      .map_err(|error| err(error.to_string()))?;
  }

  let mut sources = input.source_files.iter().collect::<Vec<_>>();
  sources.sort_by(|a, b| a.archive_path.cmp(&b.archive_path));
  for item in sources {
    writer
      .start_file(format!("{}/{}", input.root_name, item.archive_path), options)
      .map_err(|error| err(error.to_string()))?;
    let mut source = File::open(&item.source_path).map_err(|error| err(error.to_string()))?;
    let mut buffer = Vec::new();
    source.read_to_end(&mut buffer).map_err(|error| err(error.to_string()))?;
    writer.write_all(&buffer).map_err(|error| err(error.to_string()))?;
  }

  writer.finish().map_err(|error| err(error.to_string()))?;
  Ok(())
}

fn write_tar_gz_archive(input: &ArchiveCreateInput) -> Result<()> {
  let file = File::create(&input.output_path).map_err(|error| err(error.to_string()))?;
  let encoder = GzEncoder::new(file, Compression::best());
  let mut builder = TarBuilder::new(encoder);

  let mut generated = input.generated_files.iter().collect::<Vec<_>>();
  generated.sort_by(|a, b| a.archive_path.cmp(&b.archive_path));
  for item in generated {
    let bytes = item.content.as_bytes();
    let mut header = tar::Header::new_gnu();
    header.set_path(format!("{}/{}", input.root_name, item.archive_path)).map_err(|error| err(error.to_string()))?;
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
      .append(&header, Cursor::new(bytes))
      .map_err(|error| err(error.to_string()))?;
  }

  let mut sources = input.source_files.iter().collect::<Vec<_>>();
  sources.sort_by(|a, b| a.archive_path.cmp(&b.archive_path));
  for item in sources {
    let bytes = fs::read(&item.source_path).map_err(|error| err(error.to_string()))?;
    let mut header = tar::Header::new_gnu();
    header.set_path(format!("{}/{}", input.root_name, item.archive_path)).map_err(|error| err(error.to_string()))?;
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
      .append(&header, Cursor::new(bytes))
      .map_err(|error| err(error.to_string()))?;
  }

  builder.finish().map_err(|error| err(error.to_string()))?;
  let encoder = builder.into_inner().map_err(|error| err(error.to_string()))?;
  encoder.finish().map_err(|error| err(error.to_string()))?;
  Ok(())
}

#[napi]
pub fn create_archive(request_json: String) -> Result<()> {
  let input: ArchiveCreateInput =
    serde_json::from_str(&request_json).map_err(|error| err(error.to_string()))?;
  let output_path = PathBuf::from(&input.output_path);
  if let Some(parent) = output_path.parent() {
    fs::create_dir_all(parent).map_err(|error| err(error.to_string()))?;
  }
  if input.overwrite && output_path.exists() {
    fs::remove_file(&output_path).map_err(|error| err(error.to_string()))?;
  }

  match input.format.as_str() {
    "zip" => write_zip_archive(&input),
    _ => write_tar_gz_archive(&input),
  }
}
