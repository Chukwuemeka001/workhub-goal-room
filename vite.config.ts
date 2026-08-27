import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/workhub-goal-room/" : "/",
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});
