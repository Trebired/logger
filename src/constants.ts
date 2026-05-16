import type { LogLevelConfig } from "./types.js";

const TOP_LEVEL = "top-level";
const PARTITION_MARKER_FILE = ".trebired-partition.json";

const DEFAULT_LEVELS: Record<string, LogLevelConfig> = Object.freeze({
  debug: { weight: 10, label: "DEBUG", color: "#b7c063", stream: "stdout", showStack: false, bold: false },
  info: { weight: 20, label: "INFO", color: "#2958ea", stream: "stdout", showStack: false, bold: false },
  success: { weight: 25, label: "SUCCESS", color: "#51b300", stream: "stdout", showStack: false, bold: false },
  warn: { weight: 30, label: "WARN", color: "#f39c12", stream: "stderr", showStack: true, bold: false },
  fail: { weight: 40, label: "FAIL", color: "#b30027", stream: "stderr", showStack: false, bold: false },
  error: { weight: 50, label: "ERROR", color: "#b30000", stream: "stderr", showStack: true, bold: true },
});

const RESERVED_METADATA_KEYS = new Set([
  "__recorded_at",
  "configKey",
  "config_key",
  "deployment_type",
  "deployment",
  "partition",
  "group",
  "groupKey",
  "group_label",
  "groupLabel",
  "ids",
  "instanceIndex",
  "log_dir",
  "log_root",
  "meta",
  "platform_id",
  "recordedAt",
  "recorded_at",
  "source",
  "timestamp",
  "loggedAt",
  "logged_at",
]);

const DEFAULT_SENSITIVE_KEYS = new Set([
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "passwd",
  "password",
  "pwd",
  "refresh_token",
  "secret",
  "token",
  "access_token",
]);

export { DEFAULT_LEVELS, DEFAULT_SENSITIVE_KEYS, PARTITION_MARKER_FILE, RESERVED_METADATA_KEYS, TOP_LEVEL };
