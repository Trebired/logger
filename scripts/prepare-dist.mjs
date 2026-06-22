import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const packageJsonPath = path.join(rootDir, "package.json");
const tempDir = path.join(rootDir, ".tmp");
const backupPath = path.join(tempDir, "package.json.backup");

const command = process.argv[2];

async function main() {
  if (command === "prepare-dist") {
    await prepareDist();
    return;
  }

  if (command === "prepack") {
    await backupPackageJson();
    await writePublishedPackageJson();
    return;
  }

  if (command === "postpack") {
    await restorePackageJson();
    return;
  }

  throw new Error(`Unknown prepare-dist command: ${command}`);
}

async function prepareDist() {
  const packageJson = await readPackageJson();
  const files = await collectDistFiles();

  await Promise.all(files.map(async (filePath) => {
    const original = await fs.readFile(filePath, "utf8");
    const rewritten = rewriteAliasImports(original, filePath, packageJson.imports || {});

    if (rewritten !== original) {
      await fs.writeFile(filePath, rewritten);
    }
  }));
}

async function backupPackageJson() {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.copyFile(packageJsonPath, backupPath);
}

async function writePublishedPackageJson() {
  const packageJson = await readPackageJson();
  const published = {
    ...packageJson,
    imports: createPublishedImports(packageJson.imports || {}),
  };

  await fs.writeFile(packageJsonPath, `${JSON.stringify(published, null, 2)}\n`);
}

async function restorePackageJson() {
  const original = await fs.readFile(backupPath, "utf8");
  await fs.writeFile(packageJsonPath, original);
  await fs.rm(backupPath, { force: true });
}

async function readPackageJson() {
  return JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
}

async function collectDistFiles() {
  const files = [];
  const stack = [distDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }

      if (entry.isFile() && (nextPath.endsWith(".js") || nextPath.endsWith(".d.ts"))) {
        files.push(nextPath);
      }
    }
  }

  return files;
}

function rewriteAliasImports(source, filePath, importsMap) {
  return source.replace(/(["'])(#[^"']+)\1/g, (match, quote, alias) => {
    const target = importsMap[alias];
    if (!target) {
      return match;
    }

    const compiledPath = resolveCompiledTarget(String(target));
    if (!compiledPath) {
      return match;
    }

    const relativePath = toRelativeImport(path.relative(path.dirname(filePath), compiledPath));
    return `${quote}${relativePath}${quote}`;
  });
}

function createPublishedImports(importsMap) {
  return Object.fromEntries(
    Object.entries(importsMap)
      .map(([alias, target]) => [alias, resolvePublishedImportTarget(String(target))])
      .filter((entry) => Boolean(entry[1])),
  );
}

function resolvePublishedImportTarget(target) {
  const normalized = normalizePath(target);

  if (normalized.startsWith("src/")) {
    return `./dist/${replaceSourceExtension(normalized.slice(4))}`;
  }

  if (normalized.startsWith("internal/")) {
    return `./dist/internal/${replaceSourceExtension(normalized.slice(9))}`;
  }

  return null;
}

function resolveCompiledTarget(target) {
  const normalized = normalizePath(target);

  if (normalized.startsWith("src/")) {
    return path.join(distDir, replaceSourceExtension(normalized.slice(4)));
  }

  if (normalized.startsWith("internal/")) {
    return path.join(distDir, "internal", replaceSourceExtension(normalized.slice(9)));
  }

  return null;
}

function replaceSourceExtension(value) {
  return value.replace(/\.(ts|tsx|js|jsx)$/u, ".js");
}

function toRelativeImport(value) {
  const normalized = normalizePath(value);
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function normalizePath(value) {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

await main();
