use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::PathBuf;

use flate2::write::GzEncoder;
use flate2::Compression;
use napi::Result;
use serde::Deserialize;
use tar::Builder as TarBuilder;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::common::err;

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

pub fn create_archive_json(request_json: String) -> Result<()> {
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
