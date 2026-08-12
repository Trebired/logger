use std::fs;
use std::path::{Path, PathBuf};

use napi::Result;
use serde::Serialize;
use serde_json::Value;

use crate::common::{err, normalize_group_key};

const CONFIG_FILE_NAME: &str = "tb.logger.json";
const PACKAGE_FILE_NAME: &str = "package.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleVisibilityConfigOutput {
    source_path: Option<String>,
    hide_console_groups: Vec<String>,
    warning: Option<String>,
}

fn empty_output() -> ConsoleVisibilityConfigOutput {
    ConsoleVisibilityConfigOutput {
        source_path: None,
        hide_console_groups: Vec::new(),
        warning: None,
    }
}

fn output_with_warning(file_path: &Path, warning: String) -> ConsoleVisibilityConfigOutput {
    ConsoleVisibilityConfigOutput {
        source_path: Some(file_path.display().to_string()),
        hide_console_groups: Vec::new(),
        warning: Some(warning),
    }
}

fn clean_segment(value: Option<&Value>) -> Option<String> {
    value
    .and_then(|item| item.as_str())
    .map(|item| item.trim().to_string())
    .filter(|item| !item.is_empty())
}

fn package_scope(name: &str) -> Option<String> {
    let scoped = name.strip_prefix('@')?;
    let (scope, _) = scoped.split_once('/')?;
    let clean = scope.trim();
    if clean.is_empty() {
        None
    } else {
        Some(clean.to_string())
    }
}

fn package_slug(name: &str) -> Option<String> {
    let slug = if name.starts_with('@') {
        name.split_once('/').map(|(_, slug)| slug).unwrap_or(name)
    } else {
        name
    };
    let clean = slug.trim();
    if clean.is_empty() {
        None
    } else {
        Some(clean.to_string())
    }
}

fn find_ancestor_file(start_dir: &Path, file_name: &str) -> Option<PathBuf> {
    let mut current = PathBuf::from(start_dir);

    loop {
        let candidate = current.join(file_name);
        if candidate.is_file() {
            return Some(candidate);
        }

        let Some(parent) = current.parent() else {
            return None;
        };
        if parent == current {
            return None;
        }
        current = parent.to_path_buf();
    }
}

fn package_log_prefix(start_dir: &Path) -> String {
    let parsed = find_ancestor_file(start_dir, PACKAGE_FILE_NAME)
    .and_then(|file_path| fs::read_to_string(file_path).ok())
    .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let package_name = clean_segment(parsed.as_ref().and_then(|item| item.get("name")))
    .unwrap_or_else(|| "@package/logger".to_string());
    let organization = clean_segment(
        parsed
        .as_ref()
        .and_then(|item| item.get("config"))
        .and_then(|item| item.get("organization"))
        .and_then(|item| item.get("name")),
    )
    .or_else(|| package_scope(&package_name))
    .unwrap_or_else(|| "package".to_string());
    let slug = package_slug(&package_name).unwrap_or_else(|| "logger".to_string());

    format!("[{}.{}]", organization, slug)
}

fn warning_for_invalid_shape(log_prefix: &str, file_path: &Path) -> String {
    format!(
        "{} invalid {} at {}: expected an object with a hideConsoleGroups string array",
        log_prefix,
        CONFIG_FILE_NAME,
        file_path.display()
    )
}

fn warning_for_read_error(
    log_prefix: &str,
    file_path: &Path,
    message: impl Into<String>,
) -> String {
    format!(
        "{} failed to read {} at {}: {}",
        log_prefix,
        CONFIG_FILE_NAME,
        file_path.display(),
        message.into()
    )
}

fn warning_for_parse_error(
    log_prefix: &str,
    file_path: &Path,
    message: impl Into<String>,
) -> String {
    format!(
        "{} invalid JSON in {} at {}: {}",
        log_prefix,
        CONFIG_FILE_NAME,
        file_path.display(),
        message.into()
    )
}

fn normalize_groups(values: &[Value]) -> Vec<String> {
    let mut out = Vec::new();

    for value in values {
        let Some(raw) = value.as_str() else {
            continue;
        };
        let normalized = normalize_group_key(raw);
        if !out.iter().any(|existing| existing == &normalized) {
            out.push(normalized);
        }
    }

    out
}

fn parse_config_object(
    log_prefix: &str,
    file_path: &Path,
    parsed: Value,
) -> ConsoleVisibilityConfigOutput {
    let Some(object) = parsed.as_object() else {
        return output_with_warning(file_path, warning_for_invalid_shape(log_prefix, file_path));
    };

    let Some(groups) = object
    .get("hideConsoleGroups")
    .and_then(|value| value.as_array())
    else {
        return output_with_warning(file_path, warning_for_invalid_shape(log_prefix, file_path));
    };

    if groups.iter().any(|value| !value.is_string()) {
        return output_with_warning(file_path, warning_for_invalid_shape(log_prefix, file_path));
    }

    ConsoleVisibilityConfigOutput {
        source_path: Some(file_path.display().to_string()),
        hide_console_groups: normalize_groups(groups),
        warning: None,
    }
}

fn parse_config_file(log_prefix: &str, file_path: &Path) -> ConsoleVisibilityConfigOutput {
    let text = match fs::read_to_string(file_path) {
        Ok(value) => value,
        Err(error) => {
            return output_with_warning(
                file_path,
                warning_for_read_error(log_prefix, file_path, error.to_string()),
            );
        }
    };

    let parsed: Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(error) => {
            return output_with_warning(
                file_path,
                warning_for_parse_error(log_prefix, file_path, error.to_string()),
            );
        }
    };

    parse_config_object(log_prefix, file_path, parsed)
}

pub fn resolve_console_visibility_config_json(start_dir: String) -> Result<String> {
    let start = PathBuf::from(start_dir);
    let log_prefix = package_log_prefix(&start);
    let output = match find_ancestor_file(&start, CONFIG_FILE_NAME) {
        Some(file_path) => parse_config_file(&log_prefix, &file_path),
        None => empty_output(),
    };

    serde_json::to_string(&output).map_err(|error| err(error.to_string()))
}
