import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const output = join(root, "evaluation", "v3");
const expected = {
  "src/core/goalRoom.ts": "04d8e89e49ea2b14e8d22ddb404c54e923b01743390a61745bc6d2f21556ff29",
  "src/ownerController.ts": "c20507f4dfa034c5398bd6c77e4fc85b23c32587b7088b383cfdd59bf9f93adb",
  "src/verifier/releaseRules.ts": "ed94538ab54029f9b1159ad597629336fcea771ff77f1f709dc4085bac5512aa",
  "src/webmcp.ts": "021cf979a63bfe39706e9a8247fcac7f75afbc65b59aa9f0d936334bb29574e2",
  "src/webmcp-globals.d.ts": "b44e37fd6c39bed156486f84a56426e4091cb26ef1fd50bff70c5bdd048ac5cc",
};
const rows = [];
for (const [path, expectedSha256] of Object.entries(expected)) {
  const bytes = await readFile(join(root, path));
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  rows.push({ path, expectedSha256, actualSha256, unchanged: actualSha256 === expectedSha256 });
}
const evidence = {
  schemaVersion: 1,
  kind: "goal-room-v3-protected-authority-bytes",
  rows,
  passed: rows.every(({ unchanged }) => unchanged),
};
await mkdir(output, { recursive: true });
await writeFile(join(output, "protected-bytes.json"), `${JSON.stringify(evidence, null, 2)}\n`);
if (!evidence.passed) throw new Error(`Protected authority bytes changed: ${JSON.stringify(rows.filter(({ unchanged }) => !unchanged))}`);
console.log(JSON.stringify(evidence, null, 2));
