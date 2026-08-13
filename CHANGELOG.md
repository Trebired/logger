# Changelog

All notable changes to `@trebired/logger` will be documented here.

This project follows semantic versioning once published.

## 2.5.24

- Added browser runtime package-prefix inference for scoped package sources while keeping unscoped browser/app sources unprefixed.

## 2.5.22

- Fixed `.trebired/logger/config.ts` loading from installed packages under `node_modules` so Node runtimes no longer hit native TypeScript type-stripping limits.
- Added a Node package-config smoke test for installed package logger configs.

## 2.5.20

- Added `.trebired/logger/config.ts` loading and normalization helpers through `@trebired/logger/config`.
- Applied project logger defaults automatically when creating server logs while preserving caller-specific runtime options.

## 2.5.19

- Removed top-level `tb.logger.json` console visibility discovery from server and native runtimes.
- Kept console visibility controlled by explicit logger options only.

## 2.5.18

- Adopted the external `@trebired/code-discipline-config` preset and updated Code Discipline tooling to `@trebired/code-discipline@^6.0.9`.

## 2.5.17

- Updated the Code Discipline devDependency and lockfile to public `@trebired/code-discipline@^5.5.2`.
## 2.5.16

- Adopted the shared Trebired Code Discipline preset so package configs only keep repo-specific policy.
- Updated the Code Discipline devDependency and lockfile to public `@trebired/code-discipline@^5.5.1`.

## 2.5.15

- Updated the package Code Discipline config to the platform-aligned rule set, including formatting, redundant path segment cleanup, removable comment checks, structural blank lines, and dry checks.
- Updated the Code Discipline devDependency and lockfile to the current public `@trebired/code-discipline@^5.3.0`.

## 2.5.14

- Refreshed package dependency ranges and lockfile state with `bun update` after adopting the `.trebired/code-discipline` structure.

## 2.5.13

- Moved Code Discipline config, alias-map state, generated tsconfig paths, and reports to `.trebired/code-discipline/`.
- Updated the `@trebired/code-discipline` devDependency to `^4.10.0`.

## 2.5.12

- Updated Code Discipline configuration to the `imports` rule with dead import removal enabled.
- Updated logger package metadata fallback so package-owned notices stay under the organization root when package metadata is unavailable.
- Updated internal package dependency ranges to the current published sibling releases.

## 2.5.11

- Fixed a broken published-package build: a fresh checkout has no committed `.code-discipline/generated/` output, and nothing regenerated it before `typecheck`/`build`, so every internal `#hash` import failed to resolve. `typecheck` and `build` now run `prepare:generated` first.
- Standardized package metadata (author field, config-driven organization name, dropped the Node engine constraint) and migrated `.code-discipline/config.ts` to `defineCodeDisciplineConfig`.
- Normalized README structure and removed the license footer.
- Updated the `@trebired/code-discipline` devDependency to 4.8.0.

## 2.5.9

- Added package-owned organization metadata and derived logger package notices from `package.json`.
- Kept browser-facing logger constants free of package metadata filesystem reads.
- Updated internal package dependency ranges to the current sibling package releases.

## 2.5.8

- Removed dead test scripts and stale test commands from publish workflows and maintainer docs.

## 2.5.7

- Removed package test suites and banned committed `*.spec.ts`/`*.spec.tsx` files through Code Discipline.
- Added Code Discipline enforcement for hardcoded `trebired` strings outside package metadata.
- Migrated Code Discipline to `.code-discipline/config.ts` with alias-map sync output.
- Updated package-generated artifact ignores and internal package dependency ranges.

## 2.5.6

- Moved package-owned logger startup notices under the `trebired.logger.initialize` group root while leaving caller-supplied log groups unchanged.

## 2.5.5

- Added `@trebired/result` as the internal outcome surface for touched logger backend operations so rotation, finalization, and related flows no longer maintain duplicate package-local result types.
- Enforced the current `@trebired/code-discipline` policy across the touched source, native, example, and test paths while preserving the public logger API and log format behavior.

## 2.5.4

- bumped the repository package version forward after the `2.5.3` npm publish so the repo can continue from the next unreleased patch state without republishing the same contents

## 2.5.3

- fixed the packed package metadata so runtime alias imports and declaration alias imports resolve to built files that actually exist in the published tarball
- added a publish-preparation step that rewrites compiled `dist` alias imports to relative built paths and rewrites packed `package.json` imports from source aliases to `./dist/...`
- strengthened package verification to inspect the real tarball, check expected native binaries, verify TypeScript resolution, and smoke-test Bun imports for `@trebired/logger` and `@trebired/logger/browser`

## 2.5.2

- Enforced the package `tb.code-discipline.ts` policy across `src`, tests, and examples, including synced import aliases and normalized `tsconfig` path metadata.
- Reduced small duplicated helper/value logic while keeping the public logger API and runtime behavior unchanged.

## 2.5.0

- Added top-level `tb.logger.json` auto-discovery for server runtimes so developers can hide selected log groups from console output without affecting saved logs or stream events.
- Added exact-and-descendant console visibility matching for hidden groups, plus warning-and-ignore behavior for invalid `tb.logger.json` files.
- Expanded the Rust native addon with config discovery and parsing for console visibility policy loading, while keeping a behavior-matching JS fallback when native loading is unavailable.

## 2.4.3

- Changed generated partition name prefixes to include the same plain numeric sequence slot as saved log filenames, so helper-built partitions now default to shapes like `YYYY-MM-DD-HH-mm-ss-1-...`.
- Added optional `sequence` support to partition naming helpers so callers can explicitly build prefixes like `YYYY-MM-DD-HH-mm-ss-2-...`.

## 2.4.2

- Changed partition time prefixes from the old hour-only `YYYY-MM-DD-HH-0000` shape to the explicit `YYYY-MM-DD-HH-mm-ss` format.
- Changed saved log file timestamp prefixes to use the explicit `YYYY-MM-DD-HH-mm-ss` format before the trailing sequence number.
- Changed rolled log file sequence suffixes from zero-padded values like `0000` and `0001` to plain numeric values like `1`, `2`, and `10`.

## 2.4.0

- Added `finalizePartition()` on live logger instances so applications can finalize temporary partitions with package-owned merge or switch behavior instead of open-coding promotion fallbacks.
- Added structured partition finalization results, including explicit actions such as `renamed`, `merged`, `switched`, `marked-permanent`, and `already-finalized`.
- Added `ifExists` conflict policies to live partition promotion flows while keeping `promotePartition()` strict by default.
- Added `getPartitionErrorCode()` and `isPartitionError()` so advanced callers can inspect partition lifecycle failures without parsing raw error strings.

## 2.3.1

- Changed package greeting logs to use the `logger.initialize` group instead of `logger.loader`.

## 2.3.0

- Changed native storage loading to try the bundled native backend by default in all runtimes, fall back to the JS backend automatically on load failure, and use `TB_LOGGER_DISABLE_NATIVE=1` as the explicit opt-out switch.
- Added Linux ARM64 GNU to the bundled native release matrix for npm publish and package verification.

## 2.2.0

- Changed the project license from MIT to GNU AGPL-3.0.
- Added automatic cleanup for temporary partitions that are no longer current so stale temp partitions are deleted during partition switches, promotions, logger dir changes, and shutdown.
- Added partition size reporting in megabytes alongside raw bytes, plus combined `listPartitions()` totals across all returned partitions.
- Expanded the native Rust backend to rewrite partition files during copy, move, rename, and merge flows instead of leaving that work in TypeScript.
- Refactored the native crate into focused modules for scan, rewrite, archive, log-file helpers, and shared utilities, and split storage query helpers into dedicated TypeScript modules for easier maintenance.

## 2.1.1

- Changed `prepublishOnly` to build the host native addon before publish and verify the packed tarball contents.
- Added publish-time guards so full releases fail unless the expected Linux and macOS native `.node` files are present in the package tarball.
- Added npm packaging overrides for `native/*.node` so bundled binaries are not dropped from published archives.
- Changed the bundled native release matrix to publish Linux GNU and macOS binaries only, leaving musl targets on the JS fallback path for now.

## 2.1.0

- Added partition export helpers for single-partition and multi-partition exports with `tar.gz` as the default format and `.zip` as an alternate format.
- Added export convenience methods on live logger instances that flush pending writes before archiving.
- Added export archives with a shared `manifest.json` while preserving raw exported log files byte-for-byte under `logs/<partition>/...`.
- Added a Rust native storage backend for partition scanning and archive creation, plus a JS fallback backend and Bun-safe native fallback behavior.
- Added platform-specific native binary loading so one `@trebired/logger` package can bundle prebuilt Linux and macOS `.node` files under `native/` and select the right binary at runtime.
- Reused the new storage scan backend for partition info totals so large partition summaries can share the same native/JS seam as export.
- Changed error console output to keep pretty log headers while emitting a plain `path:line:column` location line and raw stack frames for better terminal and IDE navigation.

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

- Standardized package metadata ordering and contributing guidance around the Trebired writing style.
