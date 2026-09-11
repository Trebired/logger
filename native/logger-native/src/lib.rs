mod archive;
mod cleanup;
mod common;
mod log_files;
mod query;
mod query_state;
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
pub fn query_logs(request_json: String) -> Result<String> {
    query::query_logs_json(request_json)
}

#[napi]
pub fn cleanup_logs(request_json: String) -> Result<()> {
    cleanup::cleanup_logs_json(request_json)
}
