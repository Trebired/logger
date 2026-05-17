# Changelog

All notable changes to `@trebired/logger` will be documented here.

This project follows semantic versioning once published.

## 2.0.0

- Added `@trebired/logger/browser` for framework-neutral browser logging with the same levels, metadata conventions, grouping rules, and scoped logger behavior as the server logger.
- Added `@trebired/logger/browser/react` with `LogProvider`, `useLog()`, and `LogErrorBoundary` as a thin React adapter on top of the browser runtime.
- Added a runtime-neutral log stream context so stream listeners can distinguish `{ runtime: "server", dir }` from `{ runtime: "browser", transports }`.
- Rebuilt partition handling as a clean-break subsystem with no legacy partition marker or legacy log filename compatibility.
- Added partition naming helpers for time-prefixed names, arbitrary caller suffixes, full-name sanitization, and temporary partition names.
- Added live partition lifecycle APIs on logger instances, including `getPartition()`, `setPartition()`, `promotePartition()`, `listPartitions()`, and `getPartitionInfo()`.
- Added standalone partition management helpers for creating, listing, inspecting, renaming, moving, copying, merging, and deleting partitions.
- Added `deleteLogs()` for file-bucket deletion by partition, age, day, hour, group, level, and temporary-partition filters.
- Changed query metadata and partition summaries to use real partition names or `null` for unpartitioned logs.

## 1.1.3

- Added optional `partition` storage folders so one logger dir can keep separate deployments, sessions, environments, or other caller-defined log trees.
- Added `maxPartitions` retention cleanup and changed retention defaults so logs are kept forever unless a deletion number is configured.
- Added `metadata.total` and `metadata.partitions` summaries to saved-log query results.
- Replaced the old query API names with `getAllLogs()`, `getAllLogsAcrossPartitions()`, and `getLogsForDir()`.
- Removed support for `getAll()` and `getEntriesForDir()`.

## 1.1.2

- Changed saved-log query helpers to return `{ logs, levels, metadata }` instead of a bare log array.
- Added top-level level configuration metadata to query results, including custom logger levels.
- Added a continuous dummy logger demo that writes to the OS temp directory and exits cleanly on interrupt.
- Documented that the demo supports Linux and macOS; microslop Windows is not supported.
- Removed configurable `defaultGroup`; the implicit group is now always hardcoded to `"default"`.

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
