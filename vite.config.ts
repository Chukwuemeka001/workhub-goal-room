import { readFile } from "node:fs/promises";
import { defineConfig } from "vitest/config";

const root = new URL("./", import.meta.url);
const publicJudgeHelp = {
  name: "public-judge-help",
  async generateBundle() {
    for (const fileName of ["SECURITY.md", "PRIVACY.md"]) {
      this.emitFile({ type: "asset", fileName, source: await readFile(new URL(fileName, root)) });
    }
  },
};

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/workhub-goal-room/" : "/",
  plugins: [publicJudgeHelp],
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});
