import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "test-browser",
    include: ["test-browser/**/*.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      name: "chromium",
      headless: false,
    },
  },
});
