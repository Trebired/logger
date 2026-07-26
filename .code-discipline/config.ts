export default {
  ignore: {
    entries: [],
    use_gitignore: true,
  },
  rules: {
    bannedFiles: {
      patterns: [
        { glob: "**/*.spec.ts" },
        { glob: "**/*.spec.tsx" },
      ],
    },
    bannedPatterns: {
      patterns: [
        { value: "trebired", allowedFiles: ["package.json"] },
      ],
    },
    maxFileLines: {
      max: 350,
    },
    maxFunctionLines: {
      max: 50,
    },
    folderizeCompoundFiles: {},
    removeComments: {
    },
    syncImports: {
      alias: {
        strategy: "random",
      },
      allowRelative: ["./"],
      output: {
        type: "alias-map",
      },
      runtime: {
        normalize: "relative-dot-prefix",
        restoreAfterRun: false,
      },
    },
  },
};
