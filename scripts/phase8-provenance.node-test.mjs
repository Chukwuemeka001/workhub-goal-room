import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repo = resolve(import.meta.dirname, "..");
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

const listen = (server, port) => new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolveListen); });
const close = (server) => new Promise((resolveClose) => server.close(resolveClose));

test("Phase 8 visual evidence identifies the exact latest production-input commit without fixed-port coupling", async () => {
  const expectedCommit = git("log", "-1", "--format=%H", "--", "index.html", "package.json", "vite.config.ts", "src");
  const expectedTree = git("rev-parse", `${expectedCommit}^{tree}`);
  const root = mkdtempSync(join(tmpdir(), "phase8-provenance-"));
  const checkout = join(root, "checkout");
  const legacyPortBlocker = spawn(process.execPath, ["-e", "require('node:net').createServer((socket)=>socket.destroy()).listen(4189,'127.0.0.1',()=>console.log('ready'))"], { stdio: ["ignore", "pipe", "pipe"] });
  let blockerStderr = "";
  legacyPortBlocker.stderr.on("data", (chunk) => { blockerStderr += chunk; });
  const reservation = createServer();
  try {
    await new Promise((resolveReady, reject) => {
      legacyPortBlocker.once("error", reject);
      legacyPortBlocker.stdout.once("data", resolveReady);
      legacyPortBlocker.once("exit", (code) => code === 1 && blockerStderr.includes("EADDRINUSE") ? resolveReady() : reject(new Error(`legacy port blocker exited ${code}: ${blockerStderr}`)));
    });
    await listen(reservation, 0);
    const port = reservation.address().port;
    await close(reservation);
    execFileSync("git", ["-C", repo, "worktree", "add", "--detach", checkout, "HEAD"], { stdio: "ignore" });
    copyFileSync(join(repo, "scripts/phase8-visual-qa.mjs"), join(checkout, "scripts/phase8-visual-qa.mjs"));
    symlinkSync(join(repo, "node_modules"), join(checkout, "node_modules"));
    const run = spawnSync("node", ["scripts/phase8-visual-qa.mjs"], { cwd: checkout, encoding: "utf8", timeout: 120_000, env: { ...process.env, PHASE8_QA_PORT: String(port) } });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const evidence = JSON.parse(readFileSync(join(checkout, "evaluation/phase8/visual-max-hostile.json"), "utf8"));
    assert.equal(evidence.testedProductionCommit, expectedCommit);
    assert.equal(evidence.testedProductionTree, expectedTree);
  } finally {
    if (reservation.listening) await close(reservation);
    if (legacyPortBlocker.exitCode === null) legacyPortBlocker.kill("SIGTERM");
    try { execFileSync("git", ["-C", repo, "worktree", "remove", "--force", checkout], { stdio: "ignore" }); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});
