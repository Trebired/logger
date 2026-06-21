export default {
  sourceRoot: ".",
  sourceExtensions: [".ts", ".tsx", ".js", ".jsx"],
  excludeDirs: ["node_modules", "dist", "tmp", ".vite", "test", "examples"],
  logging: {
    enabled: true,
    quiet: false,
  },
  tsconfigPaths: {
    normalize: "relative-dot-prefix",
    restoreAfterRun: false,
  },
  rules: {
    maxFileLines: {
      max: 350,
    },
    maxFunctionLines: {
      max: 50,
    },
    folderizeCompoundFiles: {},
    syncImports: {
      alias: {
        strategy: "random",
      },
      allowRelative: ["./"],
      packageJsonImports: {
        enabled: true,
        aliasPrefix: "#",
      },
    },
    dry: {
      helpers: [
        {
          from: "./src/utils/values.ts",
          exportName: "toString",
        },
        {
          from: "./src/utils/values.ts",
          exportName: "asObject",
        },
        {
          from: "./src/utils/values.ts",
          exportName: "isPlainObject",
        },
      ],
    },
  },
};
