import { defineConfig } from "vitest/config"
import { playwright } from "@vitest/browser-playwright"

export default defineConfig({
  test: {
    name: "test-browser",
    include: ["test-browser/**/*.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: false,
      instances: [{ browser: "chromium" }],
    },
  },
  envDir: ".",
})
