import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";

const FILES = Object.freeze(["controller.mjs", "docker.mjs", "github.mjs", "install.mjs", "output.mjs", "receipt.mjs", "snapshot.mjs", "ui.html", "ui.js", "ui.css"]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => JSON.stringify(value);
const fail = () => { throw new Error("INSTALLED_CONTROLLER_MOVED"); };

async function atomicInstall(path, bytes, mode) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const handle = await open(temporary, "wx", mode);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await chmod(temporary, mode); await rename(temporary, path);
}

export async function installController({ sourceRoot, targetRoot, config }) {
  await mkdir(targetRoot, { recursive: true, mode: 0o700 }); const rows = [];
  for (const path of FILES) {
    const source = join(sourceRoot, path), target = join(targetRoot, path), info = await lstat(source); if (!info.isFile() || info.isSymbolicLink()) throw new Error("CONTROLLER_SOURCE_REFUSED");
    const bytes = await readFile(source); await atomicInstall(target, bytes, 0o444); rows.push({ path, bytes: bytes.length, sha256: digest(bytes), mode: "100444" });
  }
  let configuration;
  if (config !== undefined) {
    if (!config || typeof config !== "object" || Array.isArray(config) || config.installRoot !== targetRoot) throw new Error("CONTROLLER_CONFIG_REFUSED");
    const bytes = Buffer.from(`${JSON.stringify(config)}\n`); await atomicInstall(join(targetRoot, "controller-config.json"), bytes, 0o400); configuration = { path: "controller-config.json", bytes: bytes.length, sha256: digest(bytes), mode: "100400" };
  }
  const installDigest = digest(Buffer.from(canonical({ files: rows, configuration: configuration ?? null })));
  const manifest = { schema: "aca-controller-install/v2", files: rows, configuration: configuration ?? null, installDigest };
  await atomicInstall(join(targetRoot, "install-manifest.json"), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), 0o400);
  return Object.freeze(manifest);
}

export async function verifyInstalledController(targetRoot) {
  let manifest; try { manifest = JSON.parse(await readFile(join(targetRoot, "install-manifest.json"), "utf8")); } catch { fail(); }
  if (!manifest || manifest.schema !== "aca-controller-install/v2" || !Array.isArray(manifest.files) || manifest.files.length !== FILES.length) fail();
  for (let index = 0; index < FILES.length; index++) {
    const row = manifest.files[index]; if (row.path !== FILES[index] || row.mode !== "100444") fail(); const full = join(targetRoot, row.path); const info = await lstat(full), bytes = await readFile(full); if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o444 || bytes.length !== row.bytes || digest(bytes) !== row.sha256) fail();
  }
  if (manifest.configuration !== null) {
    const row = manifest.configuration; if (!row || row.path !== "controller-config.json" || row.mode !== "100400") fail(); const full = join(targetRoot, row.path); const info = await lstat(full), bytes = await readFile(full); if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o400 || bytes.length !== row.bytes || digest(bytes) !== row.sha256) fail();
  }
  if (digest(Buffer.from(canonical({ files: manifest.files, configuration: manifest.configuration }))) !== manifest.installDigest) fail();
  const directory = await stat(targetRoot); if (!directory.isDirectory()) fail(); return Object.freeze(manifest);
}
