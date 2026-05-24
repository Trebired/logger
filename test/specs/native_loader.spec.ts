import { describe, expect, test } from "bun:test";

import { nativeAddonCandidatePathsForCurrentPlatform, nativeBinaryBasenameForCurrentPlatform } from "../../src/storage/backend/native";

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
});
