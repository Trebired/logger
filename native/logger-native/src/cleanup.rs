use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use flate2::write::GzEncoder;
use flate2::Compression;
use napi::Result;
use serde::Deserialize;
use walkdir::WalkDir;

use crate::common::{err, PARTITION_MARKER_FILE};
use crate::log_files::parse_log_name;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRequest {
    dir: String,
    #[serde(default)]
    max_age_days: Option<f64>,
    #[serde(default)]
    compress_old_files: bool,
    #[serde(default)]
    max_partitions: Option<u64>,
    #[serde(default)]
    now_day: String,
    #[serde(default)]
    now_hour: String,
}

fn millis_since_epoch(time: SystemTime) -> f64 {
    time.duration_since(UNIX_EPOCH)
    .map(|value| value.as_millis() as f64)
    .unwrap_or(0.0)
}

fn compress_file(file_path: &Path) -> std::io::Result<()> {
    let target = PathBuf::from(format!("{}.gz", file_path.to_string_lossy()));
    if target.exists() {
        return fs::remove_file(file_path);
    }

    let data = fs::read(file_path)?;
    let file = File::create(&target)?;
    let mut encoder = GzEncoder::new(file, Compression::default());
    encoder.write_all(&data)?;
    encoder.finish()?;
    fs::remove_file(file_path)
}

fn cleanup_file(
    request: &CleanupRequest,
    cutoff: Option<f64>,
    partition: Option<&str>,
    abs_path: &Path,
    activity: &mut BTreeMap<String, f64>,
) {
    let file_name = abs_path
    .file_name()
    .map(|value| value.to_string_lossy().to_string())
    .unwrap_or_default();
    if file_name == PARTITION_MARKER_FILE {
        return;
    }
    let Some(parsed) = parse_log_name(&file_name) else {
        return;
    };
    let Ok(metadata) = fs::metadata(abs_path) else {
        return;
    };
    let modified = metadata
    .modified()
    .map(millis_since_epoch)
    .unwrap_or(0.0);

    if let Some(cutoff) = cutoff {
        if modified < cutoff {
            let _ = fs::remove_file(abs_path);
            return;
        }
    }

    if let Some(name) = partition {
        let entry = activity.entry(name.to_string()).or_insert(0.0);
        if modified > *entry {
            *entry = modified;
        }
    }

    let stale = parsed.day != request.now_day || parsed.hour != request.now_hour;
    if request.compress_old_files && !parsed.compressed && stale {
        let _ = compress_file(abs_path);
    }
}

fn cleanup_partitions(base_dir: &Path, request: &CleanupRequest, activity: &BTreeMap<String, f64>) {
    let Some(max_partitions) = request.max_partitions else {
        return;
    };
    let Ok(entries) = fs::read_dir(base_dir) else {
        return;
    };

    let mut roots: Vec<(PathBuf, f64)> = Vec::new();
    for entry in entries.filter_map(|item| item.ok()) {
        let path = entry.path();
        if !path.is_dir() || !path.join(PARTITION_MARKER_FILE).exists() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let last = activity.get(&name).copied().unwrap_or_else(|| {
                fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .map(millis_since_epoch)
                .unwrap_or(0.0)
        });
        roots.push((path, last));
    }

    roots.sort_by(|left, right| {
            right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    for (path, _) in roots.into_iter().skip(max_partitions as usize) {
        let _ = fs::remove_dir_all(path);
    }
}

pub fn cleanup_logs_json(request_json: String) -> Result<()> {
    let request: CleanupRequest =
    serde_json::from_str(&request_json).map_err(|error| err(error.to_string()))?;
    let base_dir = PathBuf::from(request.dir.clone());
    let cutoff = request.max_age_days.map(|days| {
            millis_since_epoch(SystemTime::now()) - days * 24.0 * 60.0 * 60.0 * 1000.0
    });
    let mut activity: BTreeMap<String, f64> = BTreeMap::new();

    let Ok(entries) = fs::read_dir(&base_dir) else {
        return Ok(());
    };

    for entry in entries.filter_map(|item| item.ok()) {
        let path = entry.path();
        if path.is_file() {
            cleanup_file(&request, cutoff, None, &path, &mut activity);
            continue;
        }
        if !path.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let partitioned = path.join(PARTITION_MARKER_FILE).exists();
        for walked in WalkDir::new(&path).into_iter().filter_map(|item| item.ok()) {
            if !walked.file_type().is_file() {
                continue;
            }
            cleanup_file(
                &request,
                cutoff,
                if partitioned { Some(&name) } else { None },
                walked.path(),
                &mut activity,
            );
        }
    }

    cleanup_partitions(&base_dir, &request, &activity);
    Ok(())
}
