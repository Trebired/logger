import { defineCodeDisciplineConfig } from "@trebired/code-discipline";

export default defineCodeDisciplineConfig({
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
        { value: "trebired", allowedFiles: ["package.json", ".code-discipline/config.ts"] },
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
    imports: {
      removeDeadImports: true,
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
});
