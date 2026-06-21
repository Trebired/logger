import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { resolveConsoleVisibilityConfigJs } from "#jp65xdmizety";
import {
  nativeAddonCandidatePathsForCurrentPlatform,
  nativeBinaryBasenameForCurrentPlatform,
  resolveNativeConsoleVisibilityConfig,
  nativeStorageBackend,
  resetNativeBindingForTests,
} from "#ho6lw68jfenw";
import { tempDir } from "./helpers";

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

  test("matches JS console visibility config fallback when native loading is disabled", () => {
    const projectRoot = tempDir("project_");
    const nestedDir = path.join(projectRoot, "apps", "api");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "tb.logger.json"), `${JSON.stringify({ hideConsoleGroups: ["blog.post", "blog.post"] })}\n`, "utf8");

    const previousDisable = process.env.TB_LOGGER_DISABLE_NATIVE;

    try {
      delete process.env.TB_LOGGER_DISABLE_NATIVE;
      resetNativeBindingForTests();
      const native = resolveNativeConsoleVisibilityConfig(nestedDir);
      if (!native) return;

      process.env.TB_LOGGER_DISABLE_NATIVE = "1";
      resetNativeBindingForTests();
      const fallback = resolveConsoleVisibilityConfigJs(nestedDir);

      expect(fallback).toEqual(native);
    } finally {
      if (previousDisable === undefined) delete process.env.TB_LOGGER_DISABLE_NATIVE;
      else process.env.TB_LOGGER_DISABLE_NATIVE = previousDisable;
      resetNativeBindingForTests();
    }
  });
});
