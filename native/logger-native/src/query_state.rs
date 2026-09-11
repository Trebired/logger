use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use chrono::DateTime;
use napi::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as JsonValue};

use crate::common::err;
use crate::log_files::read_jsonl_rows;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub dir: String,
    #[serde(default)]
    pub partition: Option<String>,
    #[serde(default)]
    pub across_partitions: bool,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub group_key: Option<String>,
    #[serde(default)]
    pub day: Option<String>,
    #[serde(default)]
    pub hour: Option<String>,
    #[serde(default)]
    pub limit: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub logs: u64,
    pub dirs: u64,
    pub files: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionItem {
    pub partition: Option<String>,
    pub count: u64,
    pub total: Totals,
}

pub struct Candidate {
    pub stamp: String,
    pub order: String,
    pub abs_path: PathBuf,
    pub compressed: bool,
    pub group_key: String,
    pub partition: Option<String>,
    pub rows: u64,
}

#[derive(Default)]
struct PartitionSummary {
    logs: u64,
    files: u64,
    dirs: BTreeSet<String>,
    matched: u64,
}

pub struct QueryState {
    summaries: BTreeMap<String, PartitionSummary>,
    partitions: BTreeMap<String, Option<String>>,
    candidates: Vec<Candidate>,
    limit: u64,
    scope_logs: u64,
    scope_files: u64,
    scope_dirs: BTreeSet<String>,
}

fn partition_key(partition: Option<&str>) -> String {
    partition.unwrap_or("__unpartitioned__").to_string()
}

fn dir_key(rel_dir: &str) -> String {
    if rel_dir.is_empty() {
        ".".to_string()
    } else {
        rel_dir.to_string()
    }
}

fn text(value: &Option<String>) -> String {
    value.as_deref().unwrap_or("").trim().to_string()
}

fn recorded_at_millis(row: &JsonValue) -> i64 {
    let Some(raw) = row.get("recorded_at").and_then(|value| value.as_str()) else {
        return 0;
    };
    DateTime::parse_from_rfc3339(raw)
    .map(|parsed| parsed.timestamp_millis())
    .unwrap_or(0)
}

pub fn matches_filters(
    request: &QueryRequest,
    level: &str,
    group_key: &str,
    day: &str,
    hour: &str,
) -> bool {
    let want_day = text(&request.day);
    let want_hour = text(&request.hour);
    let want_group = text(&request.group_key);
    let want_level = text(&request.level);

    if !want_day.is_empty() && want_day != day {
        return false;
    }
    if !want_hour.is_empty() && want_hour != hour {
        return false;
    }
    if !want_group.is_empty() && want_group != "all" && want_group != group_key {
        return false;
    }
    !(!want_level.is_empty() && want_level != "all" && want_level != level)
}

pub fn matches_scope(request: &QueryRequest, partition: Option<&str>) -> bool {
    if request.across_partitions {
        return true;
    }
    match request.partition.as_deref() {
        None => partition.is_none(),
        Some(wanted) => partition == Some(wanted),
    }
}

impl QueryState {
    pub fn new(limit: u64) -> Self {
        Self {
            summaries: BTreeMap::new(),
            partitions: BTreeMap::new(),
            candidates: Vec::new(),
            limit,
            scope_logs: 0,
            scope_files: 0,
            scope_dirs: BTreeSet::new(),
        }
    }

    pub fn record_summary(&mut self, partition: Option<&str>, rel_dir: &str, rows: u64) {
        let key = partition_key(partition);
        self.partitions
        .entry(key.clone())
        .or_insert_with(|| partition.map(|value| value.to_string()));
        let summary = self.summaries.entry(key).or_default();
        summary.logs += rows;
        summary.files += 1;
        summary.dirs.insert(dir_key(rel_dir));
    }

    pub fn record_scope(&mut self, rel_dir: &str, rows: u64) {
        self.scope_logs += rows;
        self.scope_files += 1;
        self.scope_dirs.insert(dir_key(rel_dir));
    }

    pub fn record_match(&mut self, partition: Option<&str>, rows: u64) {
        let summary = self.summaries.entry(partition_key(partition)).or_default();
        summary.matched += rows;
    }

    pub fn push_candidate(&mut self, candidate: Candidate) {
        if self.limit == 0 {
            self.candidates.push(candidate);
            return;
        }

        let position = self
        .candidates
        .binary_search_by(|item| candidate.order.cmp(&item.order))
        .unwrap_or_else(|index| index);
        self.candidates.insert(position, candidate);
        self.trim_candidates();
    }

    fn trim_candidates(&mut self) {
        let mut collected = 0_u64;
        for index in 0..self.candidates.len() {
            collected += self.candidates[index].rows;
            if collected < self.limit {
                continue;
            }
            let stamp = self.candidates[index].stamp.clone();
            let mut end = index + 1;
            while end < self.candidates.len() && self.candidates[end].stamp == stamp {
                end += 1;
            }
            self.candidates.truncate(end);
            return;
        }
    }

    pub fn scope_totals(&self) -> Totals {
        Totals {
            logs: self.scope_logs,
            dirs: self.scope_dirs.len() as u64,
            files: self.scope_files,
        }
    }

    pub fn items(&self) -> Vec<PartitionItem> {
        self.summaries
        .iter()
        .map(|(key, summary)| PartitionItem {
                partition: self.partitions.get(key).cloned().flatten(),
                count: summary.matched,
                total: Totals {
                    logs: summary.logs,
                    dirs: summary.dirs.len() as u64,
                    files: summary.files,
                },
        })
        .collect()
    }

    pub fn collect_rows(&self) -> Result<Vec<JsonValue>> {
        let mut ordered: Vec<&Candidate> = self.candidates.iter().collect();
        ordered.sort_by(|left, right| {
                left.order
                .cmp(&right.order)
                .then_with(|| left.abs_path.cmp(&right.abs_path))
        });

        let mut rows: Vec<JsonValue> = Vec::new();
        for candidate in ordered.into_iter() {
            let parsed = read_jsonl_rows(&candidate.abs_path, candidate.compressed)
            .map_err(|error| err(error.to_string()))?;
            for row in parsed {
                let JsonValue::Object(mut object) = row else {
                    continue;
                };
                apply_row_defaults(&mut object, candidate);
                rows.push(JsonValue::Object(object));
            }
        }

        rows.sort_by_key(recorded_at_millis);
        Ok(rows)
    }
}

fn apply_row_defaults(object: &mut Map<String, JsonValue>, candidate: &Candidate) {
    if !object.contains_key("group") {
        object.insert(
            "group".to_string(),
            JsonValue::String(candidate.group_key.clone()),
        );
    }
    if !object.contains_key("partition") {
        object.insert(
            "partition".to_string(),
            candidate
            .partition
            .clone()
            .map(JsonValue::String)
            .unwrap_or(JsonValue::Null),
        );
    }
}
