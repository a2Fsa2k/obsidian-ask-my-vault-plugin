// ESLint flat config for ESLint v9+
// Linting only (does not affect plugin runtime/bundle).

const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const obsidianmd = require("eslint-plugin-obsidianmd");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "main.js",
      "test_vault/**",
      ".eslintrc.*",
    ],
  },

  // Node config files (allow require/module/__dirname)
  {
    files: ["eslint.config.js", "**/*.config.{js,cjs,mjs}", "esbuild.config.mjs"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
      },
    },
  },

  // JS rules for JS/MJS files only
  {
    files: ["**/*.{js,cjs,mjs}"],
    ...js.configs.recommended,
  },

  // Typed TS rules for TS only
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // start from the recommended TS (typechecked) ruleset
      ...tseslint.configs.recommendedTypeChecked[0].rules,
    },
  },

  // Obsidian-specific rules (apply to TS only)
  ...(obsidianmd.configs?.recommended
    ? [
        {
          files: ["**/*.ts"],
          ...obsidianmd.configs.recommended,
        },
      ]
    : []),
];
