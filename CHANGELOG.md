# Changelog

All notable changes to `@trebired/logger` will be documented here.

This project follows semantic versioning once published.

## 1.1.2

- Changed saved-log query helpers to return `{ logs, levels, metadata }` instead of a bare log array.
- Added top-level level configuration metadata to query results, including custom logger levels.
- Added a continuous dummy logger demo that writes to the OS temp directory and exits cleanly on interrupt.
- Documented that the demo supports Linux and macOS; microslop Windows is not supported.

## 0.1.0

- Added top-level `timeZone` support for saved filenames and console timestamps.
- Kept `recorded_at` as UTC ISO 8601 for machine-readable log entries.
- Added `console.locale` support for console timestamp display formatting.
- Added runtime-default locale handling for console output.
- Added configurable default log group.
- Added console display options for timestamp, group, and metadata while always showing level and message.
- Added publish-ready package metadata, README, MIT license, and contribution guide.
- Added built `dist` package exports.
- Added async queued file writing with `flush()`, `close()`, and `getStats()`.
- Added group-based JSONL storage with ISO-style filenames.
- Added retention cleanup, max-size rolling, optional gzip compression, redaction, serializers, sampling, request middleware, stream events, and query helpers.
- Initial public release.
