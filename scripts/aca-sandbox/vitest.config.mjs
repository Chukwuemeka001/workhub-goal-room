import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["/work/src/**/*.test.ts"],
    exclude: ["/work/src/phase8Journey.test.ts"],
    passWithNoTests: false,
  },
});
