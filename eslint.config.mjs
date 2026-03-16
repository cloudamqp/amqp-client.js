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
    files: ["examples/*.js", "scripts/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
)
