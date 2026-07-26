import {
  buildPackageLogGroup,
  PACKAGE_NAME,
} from "#qz1iteme01ng";

const LOGGER_LOG_GROUP = buildPackageLogGroup();
const LOGGER_PACKAGE_NAME = PACKAGE_NAME;

let nodeRuntimeNoticeShown = false;

function isBunRuntime(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as any).Bun !== "undefined";
}

function isNodeRuntime(): boolean {
  return (
    typeof process !== "undefined" &&
    Boolean(process.versions && process.versions.node) &&
    !isBunRuntime()
  );
}

function writePackageNotice(message: string): void {
  try {
    if (process.stderr && typeof process.stderr.write === "function") {
      process.stderr.write(`${message}\n`);
      return;
    }
  } catch {}

  try {
    console.warn(message);
  } catch {}
}

function maybeShowNodeRuntimeNotice(quiet?: boolean): void {
  if (quiet === true || nodeRuntimeNoticeShown || !isNodeRuntime()) return;
  nodeRuntimeNoticeShown = true;
  const message = [
    `[${LOGGER_LOG_GROUP}] Running on Node.js.`,
    `${LOGGER_PACKAGE_NAME} is compatible with Node.js and Bun, but Bun is recommended for best startup and file I/O performance.`,
    "Bun is the future-facing JavaScript runtime this package is optimized for.",
    "Pass quiet: true to hide package notices.",
  ].join(" ");

  writePackageNotice(message);
}

export { isBunRuntime, isNodeRuntime, maybeShowNodeRuntimeNotice, writePackageNotice };
