import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "dist");
const output = join(root, "evaluation", "v3");
const forbiddenTokens = [
  "qualification/v3-fixture",
  "__v3Qualification",
  "V3_STORY_CATALOG",
  "synthetic-test-only-transient",
  "v3Qualification()",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function run(command, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} ${args.join(" ")} exited ${code ?? signal}`)));
  });
}
async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    if ((await stat(path)).isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

await run("npm", ["run", "build"]);
const productionEntries = ["index.html", "src/main.ts"];
const entryReferences = [];
for (const path of productionEntries) {
  const content = await readFile(join(root, path), "utf8");
  if (content.includes("qualification/")) entryReferences.push(path);
}
const leaks = [];
const builtFiles = [];
for (const path of await filesUnder(dist)) {
  const relativePath = path.slice(dist.length + 1);
  const bytes = await readFile(path);
  builtFiles.push({ path: relativePath, sha256: sha256(bytes), bytes: bytes.byteLength });
  if (![".html", ".js", ".css"].includes(extname(path))) continue;
  const content = bytes.toString("utf8");
  for (const token of forbiddenTokens) if (content.includes(token)) leaks.push({ path: relativePath, token });
}
const evidence = {
  schemaVersion: 1,
  kind: "goal-room-v3-production-exclusion",
  productionEntries,
  entryReferences,
  forbiddenTokens,
  leaks,
  builtFiles,
  passed: entryReferences.length === 0 && leaks.length === 0,
};
await mkdir(output, { recursive: true });
await writeFile(join(output, "fixture-exclusion.json"), `${JSON.stringify(evidence, null, 2)}\n`);
if (!evidence.passed) throw new Error(`V3 qualification fixture exclusion failed: ${JSON.stringify({ entryReferences, leaks })}`);
console.log(JSON.stringify({ builtProduction: true, entryReferences, leaks, files: builtFiles.length, passed: true }, null, 2));
