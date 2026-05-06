import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import globals from "globals"
import prettierConfig from "eslint-config-prettier"

export default tseslint.config(
  {
    ignores: ["**/types/", "**/dist/", "**/lib/"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettierConfig,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "test-browser/**/*.ts"],
    rules: {
      // {} is used extensively as a default for ParserMap/CoderMap generics
      "@typescript-eslint/no-empty-object-type": ["error", { allowObjectTypes: "always" }],
    },
  },
  {
    files: ["examples/*.js", "scripts/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
)
