import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "dist");
const authoritative = ["SECURITY.md", "PRIVACY.md"];
let server;

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [relative(dist, path).split(sep).join("/")];
  }));
  return nested.flat().sort();
}

async function build(githubActions) {
  execFileSync("npm", ["run", "build"], {
    cwd: root,
    env: { ...process.env, ...(githubActions ? { GITHUB_ACTIONS: "1" } : { GITHUB_ACTIONS: "" }) },
    stdio: "pipe",
  });
  const files = await filesUnder(dist);
  assert.equal(files.length, 5);
  assert.deepEqual(files.filter((path) => !path.startsWith("assets/")), ["PRIVACY.md", "SECURITY.md", "index.html"]);
  assert.equal(files.filter((path) => /^assets\/index-[A-Za-z0-9_-]+\.css$/.test(path)).length, 1);
  assert.equal(files.filter((path) => /^assets\/index-[A-Za-z0-9_-]+\.js$/.test(path)).length, 1);
  for (const name of authoritative) {
    assert.deepEqual(await readFile(join(dist, name)), await readFile(join(root, name)), `${name} must be byte-identical to the authoritative root document`);
  }
}

async function startStaticServer() {
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const stripped = pathname.replace(/^\/workhub-goal-room(?=\/)/, "");
    const requested = stripped === "/" ? "index.html" : stripped.replace(/^\/+/, "");
    const path = resolve(dist, requested);
    if (path !== dist && !path.startsWith(`${dist}${sep}`)) { response.writeHead(400).end(); return; }
    try {
      const body = await readFile(path);
      response.writeHead(200, { "content-type": extname(path) === ".md" ? "text/markdown" : "application/octet-stream" });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return `http://127.0.0.1:${server.address().port}`;
}

after(async () => { if (server) await new Promise((resolveClose) => server.close(resolveClose)); });

test("local production build serves authoritative judge-help documents", async () => {
  await build(false);
  const origin = await startStaticServer();
  for (const name of authoritative) {
    const response = await fetch(`${origin}/${name}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(root, name)));
  }
  await new Promise((resolveClose) => server.close(resolveClose)); server = undefined;
});

test("Pages-mode production build serves authoritative judge-help documents under the repository base", async () => {
  await build(true);
  const origin = await startStaticServer();
  for (const name of authoritative) {
    const response = await fetch(`${origin}/workhub-goal-room/${name}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(root, name)));
  }
});
