import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

async function writeConsumerNodeRuntime(consumerDir) {
  await fs.writeFile(path.join(consumerDir, "runtime-node.mjs"), [
      'import fs from "node:fs/promises";',
      'import { fileURLToPath } from "node:url";',
      'import { loadConfigSync } from "@package/logger/config";',
      "",
      "const fixtureEntry = fileURLToPath(new URL('./node_modules/@fixture/package-logger-user/index.mjs', import.meta.url));",
      "const loaded = loadConfigSync(process.cwd(), { searchFrom: fixtureEntry });",
      "if (loaded.config.prefix !== 'trebired') throw new Error('node package config prefix was not loaded');",
      "const fixture = await import('@fixture/package-logger-user');",
      "await fixture.runPackageLogger();",
      "const packageFiles = await Array.fromAsync((async function* walk(dir) {",
      "  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {",
      "    const filePath = `${dir}/${entry.name}`;",
      "    if (entry.isDirectory()) yield* walk(filePath);",
      "    else if (entry.isFile() && filePath.endsWith('.jsonl')) yield filePath;",
      "  }",
      "})('./package-logs'));",
      "const packageLines = (await Promise.all(packageFiles.map((file) => fs.readFile(file, 'utf8')))).join('').trim().split('\\n').filter(Boolean);",
      "const packageEntry = JSON.parse(packageLines.find((line) => line.includes('package keep')) || '{}');",
      "if (packageEntry.group !== 'trebired.bundler.build') throw new Error(`node package config prefix was not applied: ${packageEntry.group}`);",
      "",
    ].join("\n"));
}

function runConsumerRuntimes(consumerDir) {
  execFileSync("bun", ["runtime-main.ts"], {
      cwd: consumerDir,
      stdio: "inherit",
  });

  execFileSync("node", ["runtime-node.mjs"], {
      cwd: consumerDir,
      stdio: "inherit",
  });

  execFileSync("bun", ["runtime-browser.ts"], {
      cwd: consumerDir,
      stdio: "inherit",
  });
}

export {
  runConsumerRuntimes,
  writeConsumerNodeRuntime,
};
