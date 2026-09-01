import { readFile } from "node:fs/promises";
import { defineConfig } from "vitest/config";
import { createAgentChangeAssurancePlugin } from "./scripts/agent-change-assurance-vite-plugin.mjs";

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
  build: { cssTarget: "safari16.3" },
  plugins: [publicJudgeHelp, createAgentChangeAssurancePlugin({
    repositoryRoot: new URL(".", root).pathname,
    baseCommit: process.env.WORKHUB_ACA_BASE_COMMIT,
  })],
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});
