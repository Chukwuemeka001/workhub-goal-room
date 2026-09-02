import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("./deploy.yml", import.meta.url);
const deployOnly = "github.event_name == 'push' && github.ref == 'refs/heads/main'";

test("pull requests test with read-only authority while Pages effects remain main-push-only", async () => {
  const source = await readFile(workflowUrl, "utf8");
  assert.match(source, /on:\n  push:\n    branches: \[main\]\n  pull_request:\n    branches: \[main\]\n  workflow_dispatch:/);

  const globalPermissions = source.match(/\npermissions:\n((?:  [^\n]+\n)+)/)?.[1] ?? "";
  assert.equal(globalPermissions, "  contents: read\n");

  const condition = "if: ${{ " + deployOnly + " }}";
  assert.ok(source.includes(`      - name: Upload Pages artifact\n        ${condition}\n        uses: actions/upload-pages-artifact@v3`));

  const deploy = source.slice(source.indexOf("  deploy:\n"));
  assert.ok(deploy.includes(`  deploy:\n    ${condition}`));
  assert.match(deploy, /    permissions:\n      contents: read\n      pages: write\n      id-token: write\n/);
  assert.ok(source.includes("      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n          ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}"));
  assert.ok(source.includes("      - run: node --test .github/workflows/deploy.node-test.mjs\n      - run: npm test"));
  assert.match(source, /    concurrency:\n      group: pages\n      cancel-in-progress: true\n/);
  assert.doesNotMatch(source.slice(0, source.indexOf("jobs:\n")), /\nconcurrency:\n/);
});
