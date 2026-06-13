use std::fs;
use std::path::{Path, PathBuf};

use napi::Result;
use serde::Serialize;
use serde_json::Value;

use crate::common::{err, normalize_group_key};

const CONFIG_FILE_NAME: &str = "tb.logger.json";

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

fn warning_for_invalid_shape(file_path: &Path) -> String {
  format!(
    "[trebired.logger] invalid {} at {}: expected an object with a hideConsoleGroups string array",
    CONFIG_FILE_NAME,
    file_path.display()
  )
}

fn warning_for_read_error(file_path: &Path, message: impl Into<String>) -> String {
  format!(
    "[trebired.logger] failed to read {} at {}: {}",
    CONFIG_FILE_NAME,
    file_path.display(),
    message.into()
  )
}

fn warning_for_parse_error(file_path: &Path, message: impl Into<String>) -> String {
  format!(
    "[trebired.logger] invalid JSON in {} at {}: {}",
    CONFIG_FILE_NAME,
    file_path.display(),
    message.into()
  )
}

fn discover_config_path(start_dir: &Path) -> Option<PathBuf> {
  let mut current = PathBuf::from(start_dir);

  loop {
    let candidate = current.join(CONFIG_FILE_NAME);
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

fn parse_config_file(file_path: &Path) -> ConsoleVisibilityConfigOutput {
  let text = match fs::read_to_string(file_path) {
    Ok(value) => value,
    Err(error) => {
      return ConsoleVisibilityConfigOutput {
        source_path: Some(file_path.display().to_string()),
        hide_console_groups: Vec::new(),
        warning: Some(warning_for_read_error(file_path, error.to_string())),
      };
    }
  };

  let parsed: Value = match serde_json::from_str(&text) {
    Ok(value) => value,
    Err(error) => {
      return ConsoleVisibilityConfigOutput {
        source_path: Some(file_path.display().to_string()),
        hide_console_groups: Vec::new(),
        warning: Some(warning_for_parse_error(file_path, error.to_string())),
      };
    }
  };

  let Some(object) = parsed.as_object() else {
    return ConsoleVisibilityConfigOutput {
      source_path: Some(file_path.display().to_string()),
      hide_console_groups: Vec::new(),
      warning: Some(warning_for_invalid_shape(file_path)),
    };
  };

  let Some(groups) = object.get("hideConsoleGroups").and_then(|value| value.as_array()) else {
    return ConsoleVisibilityConfigOutput {
      source_path: Some(file_path.display().to_string()),
      hide_console_groups: Vec::new(),
      warning: Some(warning_for_invalid_shape(file_path)),
    };
  };

  if groups.iter().any(|value| !value.is_string()) {
    return ConsoleVisibilityConfigOutput {
      source_path: Some(file_path.display().to_string()),
      hide_console_groups: Vec::new(),
      warning: Some(warning_for_invalid_shape(file_path)),
    };
  }

  ConsoleVisibilityConfigOutput {
    source_path: Some(file_path.display().to_string()),
    hide_console_groups: normalize_groups(groups),
    warning: None,
  }
}

pub fn resolve_console_visibility_config_json(start_dir: String) -> Result<String> {
  let start = PathBuf::from(start_dir);
  let output = match discover_config_path(&start) {
    Some(file_path) => parse_config_file(&file_path),
    None => empty_output(),
  };

  serde_json::to_string(&output).map_err(|error| err(error.to_string()))
}
