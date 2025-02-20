import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/types/", "**/dist/", "**/lib/"]
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["examples/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  }
);
