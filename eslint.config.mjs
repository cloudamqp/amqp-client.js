import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import globals from "globals"
import prettierConfig from "eslint-config-prettier"

export default tseslint.config(
  {
    ignores: ["**/types/", "**/dist/", "**/lib/"],
  },
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  prettierConfig,
  {
    rules: {
      // void is idiomatic in callback union types (msg => void | Promise<void>)
      "@typescript-eslint/no-invalid-void-type": "off",
      // .catch(() => {}) is intentional fire-and-forget
      "@typescript-eslint/no-empty-function": ["error", { allow: ["arrowFunctions"] }],
      // Some types use intersections and can't be interfaces
      "@typescript-eslint/consistent-type-definitions": "off",
    },
  },
  {
    files: ["test/**/*.ts", "test-browser/**/*.ts"],
    rules: {
      // Non-null assertions are common in test code after setup
      "@typescript-eslint/no-non-null-assertion": "off",
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
