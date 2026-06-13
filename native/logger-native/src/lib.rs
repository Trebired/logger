mod archive;
mod common;
mod config;
mod log_files;
mod rewrite;
mod scan;

use napi::Result;
use napi_derive::napi;

#[napi]
pub fn scan_partitions(dir: String, partitions: Vec<String>) -> Result<String> {
  scan::scan_partitions_json(dir, partitions)
}

#[napi]
pub fn rewrite_partition_files(request_json: String) -> Result<()> {
  rewrite::rewrite_partition_files_json(request_json)
}

#[napi]
pub fn create_archive(request_json: String) -> Result<()> {
  archive::create_archive_json(request_json)
}

#[napi]
pub fn resolve_console_visibility_config(start_dir: String) -> Result<String> {
  config::resolve_console_visibility_config_json(start_dir)
}
