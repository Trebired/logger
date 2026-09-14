use std::path::{Path, PathBuf};

use napi::Result;
use serde::Serialize;
use serde_json::Value as JsonValue;
use walkdir::WalkDir;

use crate::common::{err, PARTITION_MARKER_FILE};
use crate::log_files::{count_rows, group_key_from_dir, parse_log_name, ParsedLogFile};
use crate::query_state::{
    matches_filters, matches_scope, Candidate, PartitionItem, QueryRequest, QueryState, Totals,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryResponse {
    logs: Vec<JsonValue>,
    items: Vec<PartitionItem>,
    scope: Totals,
}

fn relative_dir(abs_path: &Path, rel_root: &Path) -> String {
    abs_path
    .parent()
    .and_then(|parent| parent.strip_prefix(rel_root).ok())
    .map(|value| value.to_string_lossy().replace('\\', "/"))
    .unwrap_or_default()
}

fn build_candidate(
    abs_path: &Path,
    parsed: &ParsedLogFile,
    group_key: String,
    partition: Option<&str>,
    rows: u64,
) -> Candidate {
    Candidate {
        stamp: format!(
            "{}-{}-{}-{}",
            parsed.day, parsed.hour, parsed.minute, parsed.second
        ),
        order: format!(
            "{}-{}-{}-{}-{:06}",
            parsed.day, parsed.hour, parsed.minute, parsed.second, parsed.sequence
        ),
        abs_path: abs_path.to_path_buf(),
        compressed: parsed.compressed,
        group_key,
        partition: partition.map(|value| value.to_string()),
        rows,
    }
}

fn visit_file(
    state: &mut QueryState,
    request: &QueryRequest,
    partition: Option<&str>,
    rel_root: &Path,
    abs_path: &Path,
) -> Result<()> {
    let file_name = abs_path
    .file_name()
    .map(|value| value.to_string_lossy().to_string())
    .unwrap_or_default();
    if file_name == PARTITION_MARKER_FILE {
        return Ok(());
    }
    let Some(parsed) = parse_log_name(&file_name) else {
        return Ok(());
    };

    let rel_dir = relative_dir(abs_path, rel_root);
    let rows = if request.totals {
        count_rows(abs_path, parsed.compressed).map_err(|error| err(error.to_string()))?
    } else {
        0
    };
    let group_key = group_key_from_dir(&rel_dir);
    state.record_summary(partition, &rel_dir, rows);

    if !matches_scope(request, partition) {
        return Ok(());
    }
    state.record_scope(&rel_dir, rows);

    if !matches_filters(request, &parsed.level, &group_key, &parsed.day, &parsed.hour) {
        return Ok(());
    }

    state.record_match(partition, rows);
    state.push_candidate(build_candidate(abs_path, &parsed, group_key, partition, rows));
    Ok(())
}

fn walk_tree(
    state: &mut QueryState,
    request: &QueryRequest,
    partition: Option<&str>,
    rel_root: &Path,
    start_dir: &Path,
) -> Result<()> {
    for entry in WalkDir::new(start_dir)
    .into_iter()
    .filter_map(|item| item.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        visit_file(state, request, partition, rel_root, entry.path())?;
    }
    Ok(())
}

fn walk_base_dir(state: &mut QueryState, request: &QueryRequest, base_dir: &Path) -> Result<()> {
    let Ok(entries) = std::fs::read_dir(base_dir) else {
        return Ok(());
    };

    for entry in entries.filter_map(|item| item.ok()) {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if path.join(PARTITION_MARKER_FILE).exists() {
                walk_tree(state, request, Some(&name), &path, &path)?;
                continue;
            }
            walk_tree(state, request, None, base_dir, &path)?;
            continue;
        }
        if path.is_file() {
            visit_file(state, request, None, base_dir, &path)?;
        }
    }
    Ok(())
}

pub fn query_logs_json(request_json: String) -> Result<String> {
    let request: QueryRequest =
    serde_json::from_str(&request_json).map_err(|error| err(error.to_string()))?;
    let base_dir = PathBuf::from(request.dir.clone());
    let limit = request.limit.unwrap_or(0);
    let mut state = QueryState::new(limit, request.totals);

    walk_base_dir(&mut state, &request, &base_dir)?;

    let mut logs = state.collect_rows()?;
    if limit > 0 && logs.len() as u64 > limit {
        logs.drain(0..(logs.len() - limit as usize));
    }

    serde_json::to_string(&QueryResponse {
            logs,
            items: state.items(),
            scope: state.scope_totals(),
    })
    .map_err(|error| err(error.to_string()))
}
