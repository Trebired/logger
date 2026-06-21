export default {
  sourceRoot: "src",
  sourceExtensions: [".ts", ".tsx", ".js", ".jsx"],
  excludeDirs: ["node_modules", "dist", "tmp", ".vite"],
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
          from: "./src/backend/utils/normalize.ts",
          exportName: "toString",
        },
        {
          from: "./src/backend/utils/time.ts",
          exportName: "now",
        },
        {
          from: "./src/backend/utils/time.ts",
          exportName: "nowMs",
        },
        {
          from: "./src/backend/utils/object.ts",
          exportName: "toObject",
        },
        {
          from: "./src/backend/utils/object.ts",
          exportName: "toArray",
        },
        {
          from: "./src/frontend/js/utils/text.ts",
          exportName: "text",
        },
      ],
    },
  },
};
