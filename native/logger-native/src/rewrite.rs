use std::fs;
use std::path::PathBuf;

use napi::Result;
use serde::Deserialize;
use serde_json::Value as JsonValue;

use crate::common::err;
use crate::log_files::{
  collect_partition_files,
  find_available_target_path,
  read_jsonl_rows,
  write_jsonl_rows,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartitionRewriteInput {
  source_root: String,
  target_root: String,
  target_name: String,
  merge: bool,
}

fn rewrite_partition_files_internal(input: &PartitionRewriteInput) -> Result<()> {
  let source_root = PathBuf::from(&input.source_root);
  let target_root = PathBuf::from(&input.target_root);
  let files = collect_partition_files(&source_root);

  for file in files.iter() {
    let rows = read_jsonl_rows(&file.abs_path, file.parsed.compressed)
      .map_err(|error| err(error.to_string()))?;
    let next_rows = rows
      .into_iter()
      .map(|row| match row {
        JsonValue::Object(mut object) => {
          object.insert(
            "partition".to_string(),
            JsonValue::String(input.target_name.clone()),
          );
          JsonValue::Object(object)
        }
        other => other,
      })
      .collect::<Vec<_>>();
    let target_dir = if file.rel_dir.is_empty() {
      target_root.clone()
    } else {
      target_root.join(&file.rel_dir)
    };
    fs::create_dir_all(&target_dir).map_err(|error| err(error.to_string()))?;
    let target_path = if input.merge {
      find_available_target_path(&target_dir, file)
    } else {
      target_dir.join(&file.file_name)
    };
    write_jsonl_rows(&target_path, &next_rows, file.parsed.compressed)
      .map_err(|error| err(error.to_string()))?;
  }

  Ok(())
}

pub fn rewrite_partition_files_json(request_json: String) -> Result<()> {
  let input: PartitionRewriteInput =
    serde_json::from_str(&request_json).map_err(|error| err(error.to_string()))?;
  rewrite_partition_files_internal(&input)
}
