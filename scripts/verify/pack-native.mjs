const nativeTargets = await import(new URL("../native-targets.mjs", import.meta.url).href);
const { RELEASE_NATIVE_TARGETS, expectedHostBinaryName, nativeBinaryNameForTarget } = nativeTargets;

export function validateNativeEntries(tarballEntries) {
  const expected = expectedNativePackPaths(resolveNativeScope());

  for (const nativePath of expected) {
    assertNativeTarEntryExists(tarballEntries, nativePath);
  }
}

function expectedNativePackPaths(scope) {
  if (scope === "matrix") {
    return RELEASE_NATIVE_TARGETS.map((target) => `./native/${nativeBinaryNameForTarget(target)}`);
  }

  if (scope === "host") {
    const hostBinary = expectedHostBinaryName();
    return hostBinary ? [`./native/${hostBinary}`] : [];
  }

  return [];
}

function resolveNativeScope() {
  return process.env.TB_LOGGER_VERIFY_NATIVE_SCOPE === "matrix"
  ? "matrix"
  : "host";
}

function assertNativeTarEntryExists(tarballEntries, packagePath) {
  const normalized = `package/${String(packagePath).replace(/^\.\//u, "")}`;

  if (!tarballEntries.has(normalized)) {
    throw new Error(`Missing packed native binary: ${packagePath}`);
  }
}
