import { describe, expect, test } from "bun:test";

import {
  nativeAddonCandidatePathsForCurrentPlatform,
  nativeBinaryBasenameForCurrentPlatform,
  nativeStorageBackend,
  resetNativeBindingForTests,
} from "../../src/storage/backend/native";

describe("native addon loader", () => {
  test("derives a platform-specific binary name for supported runtimes", () => {
    const name = nativeBinaryBasenameForCurrentPlatform();
    if (["linux", "darwin"].includes(process.platform) && ["x64", "arm64"].includes(process.arch)) {
      expect(typeof name).toBe("string");
      expect(String(name)).toEndWith(".node");
      return;
    }
    expect(name).toBe(null);
  });

  test("prioritizes platform-specific native candidates before generic fallback paths", () => {
    const paths = nativeAddonCandidatePathsForCurrentPlatform();
    if (!paths.length) return;

    const specific = nativeBinaryBasenameForCurrentPlatform();
    if (specific) expect(paths[0].endsWith(specific) || paths[1]?.endsWith(specific)).toBe(true);
    expect(paths.some((item) => item.endsWith("native/index.node"))).toBe(true);
  });

  test("disables native loading only when TB_LOGGER_DISABLE_NATIVE=1", () => {
    const previousDisable = process.env.TB_LOGGER_DISABLE_NATIVE;

    try {
      process.env.TB_LOGGER_DISABLE_NATIVE = "1";
      resetNativeBindingForTests();
      expect(nativeStorageBackend()).toBe(null);
    } finally {
      if (previousDisable === undefined) delete process.env.TB_LOGGER_DISABLE_NATIVE;
      else process.env.TB_LOGGER_DISABLE_NATIVE = previousDisable;
      resetNativeBindingForTests();
    }
  });

  test("keeps native loading behavior unchanged when the disable env is absent", () => {
    const previousDisable = process.env.TB_LOGGER_DISABLE_NATIVE;

    try {
      delete process.env.TB_LOGGER_DISABLE_NATIVE;
      resetNativeBindingForTests();
      const firstLoad = nativeStorageBackend();

      delete process.env.TB_LOGGER_DISABLE_NATIVE;
      resetNativeBindingForTests();
      const secondLoad = nativeStorageBackend();

      expect(Boolean(secondLoad)).toBe(Boolean(firstLoad));
      expect(secondLoad?.name ?? null).toBe(firstLoad?.name ?? null);
    } finally {
      if (previousDisable === undefined) delete process.env.TB_LOGGER_DISABLE_NATIVE;
      else process.env.TB_LOGGER_DISABLE_NATIVE = previousDisable;
      resetNativeBindingForTests();
    }
  });
});
