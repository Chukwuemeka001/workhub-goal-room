import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { captureSnapshot, createSnapshotTarStream, decodeSnapshotBundle, decodeSnapshotTar, revalidateSnapshot, SNAPSHOT_LIMITS } from "./snapshot.mjs";

const git = (cwd, ...args) => { const r=spawnSync("/usr/bin/git",args,{cwd,encoding:"utf8",env:{PATH:"/usr/bin:/bin",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_NO_REPLACE_OBJECTS:"1"}}); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
async function repo(t) { const root=await mkdtemp(join(tmpdir(),"aca-snapshot-")); t.after(()=>rm(root,{recursive:true,force:true})); git(root,"init","-q"); git(root,"config","user.name","ACA"); git(root,"config","user.email","aca@example.invalid"); await mkdir(join(root,"src")); await writeFile(join(root,"src/a.txt"),"head\n"); await writeFile(join(root,"package.json"),"{}\n"); git(root,"add","-A");git(root,"commit","-qm","head"); return root; }

test("cumulative overlay, not HEAD-only bytes, defines snapshot identity and movement", async t => {
  const root=await repo(t); const head=git(root,"rev-parse","HEAD");const scratch=await mkdtemp(join(tmpdir(),"aca-identity-"));t.after(()=>rm(scratch,{recursive:true,force:true}));
  await writeFile(join(root,"src/a.txt"),"accepted overlay\n");
  const first=await captureSnapshot({root,parentCommit:head,allowedPaths:["src/a.txt"],excludedPrefixes:["node_modules","dist",".hermes"],scratchParent:scratch});t.after(()=>first.cleanup());
  assert.equal(first.parentCommit,head); assert.equal(first.entries.find(e=>e.path==="src/a.txt").size,17);
  assert.equal(first.entries.some(entry=>Object.hasOwn(entry,"content")),false);
  assert.match(first.snapshotDigest,/^[0-9a-f]{64}$/); assert.match(first.overlayFingerprint,/^[0-9a-f]{64}$/);
  await writeFile(join(root,"src/a.txt"),"different accepted overlay\n");
  const second=await captureSnapshot({root,parentCommit:head,allowedPaths:["src/a.txt"],excludedPrefixes:["node_modules","dist",".hermes"],scratchParent:scratch});t.after(()=>second.cleanup());
  assert.notEqual(second.snapshotDigest,first.snapshotDigest); assert.notEqual(second.overlayFingerprint,first.overlayFingerprint);
  await assert.rejects(()=>revalidateSnapshot(root,first),/SOURCE_MOVED/);
  await assert.rejects(()=>captureSnapshot({root,parentCommit:head,allowedPaths:[],requiredOverlayPaths:["src/a.txt"],excludedPrefixes:["node_modules","dist",".hermes"]}),/HEAD_ONLY_WRONG_SUBJECT/);
});

test("snapshot framing and one-entry ustar are exact and reject tampering", async t => {
  const root=await repo(t); const head=git(root,"rev-parse","HEAD"); await writeFile(join(root,"src/a.txt"),"overlay\0binary");
  const scratch=await mkdtemp(join(tmpdir(),"aca-sealed-"));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const shot=await captureSnapshot({root,parentCommit:head,allowedPaths:["src/a.txt"],excludedPrefixes:["node_modules","dist",".hermes"],scratchParent:scratch});t.after(()=>shot.cleanup());
  const inner=await readFile(shot.sealed.path); const decoded=decodeSnapshotBundle(inner);
  assert.equal(decoded.snapshotDigest,shot.snapshotDigest); assert.equal(decoded.entries.find(entry=>entry.path==="src/a.txt").content.toString("hex"),Buffer.from("overlay\0binary").toString("hex"));
  const chunks=[];for await(const chunk of createSnapshotTarStream(shot.sealed))chunks.push(chunk);const outer=Buffer.concat(chunks);const transport=decodeSnapshotTar(outer);
  assert.equal(transport.name,"sealed/snapshot.bin"); assert.equal(transport.mode,"100444"); assert.deepEqual(transport.content,inner);
  assert.equal(outer.length,512+Math.ceil(inner.length/512)*512+1024);
  for (const mutate of [b=>{b[0]^=1;},b=>{b[b.length-1]=1;},b=>{b[512]^=1;}]) { const bad=Buffer.from(outer); mutate(bad); assert.throws(()=>decodeSnapshotTar(bad)); }
  const badInner=Buffer.from(inner); badInner[badInner.length-1]^=1; assert.throws(()=>decodeSnapshotBundle(badInner),/BUNDLE_DIGEST_MISMATCH/);
});

test("snapshot resource limits reject before oversized reads and enforce checked arithmetic", async t => {
  const root=await repo(t); const head=git(root,"rev-parse","HEAD");
  await writeFile(join(root,"big.bin"),Buffer.alloc(17*1024*1024));
  await assert.rejects(()=>captureSnapshot({root,parentCommit:head,allowedPaths:["big.bin"],excludedPrefixes:[]}),/FILE_SIZE_LIMIT/);
  assert.equal(SNAPSHOT_LIMITS.maxEntries,10000); assert.equal(SNAPSHOT_LIMITS.maxPathBytes,500); assert.equal(SNAPSHOT_LIMITS.maxFileBytes,16777216); assert.equal(SNAPSHOT_LIMITS.maxContentBytes,268435456); assert.equal(SNAPSHOT_LIMITS.maxManifestBytes,8388608); assert.equal(SNAPSHOT_LIMITS.chunkBytes,65536);
});

test("descriptor capture and one-entry ustar never buffer file content and never request more than 64 KiB", async t => {
  const root=await repo(t);const head=git(root,"rev-parse","HEAD");const scratch=await mkdtemp(join(tmpdir(),"aca-streaming-"));t.after(()=>rm(scratch,{recursive:true,force:true}));
  await writeFile(join(root,"src/a.txt"),Buffer.alloc(SNAPSHOT_LIMITS.chunkBytes*3+17,0x61));
  const requested=[];const shot=await captureSnapshot({root,parentCommit:head,allowedPaths:["src/a.txt"],excludedPrefixes:[],scratchParent:scratch,observeReadSize:size=>requested.push(size)});t.after(()=>shot.cleanup());
  assert.equal(shot.entries.some(entry=>Buffer.isBuffer(entry.content)),false);
  const tarChunks=[];for await(const chunk of createSnapshotTarStream(shot.sealed,{observeReadSize:size=>requested.push(size)})){assert.ok(chunk.length<=SNAPSHOT_LIMITS.chunkBytes);tarChunks.push(chunk.length);}
  assert.ok(requested.length>3);assert.ok(requested.every(size=>size>0&&size<=SNAPSHOT_LIMITS.chunkBytes));assert.ok(tarChunks.length>3);
});

test("base diff numstat is derived from captured bytes for A/M/D/binary and matches trusted Git", async t => {
  const root=await repo(t);const base=git(root,"rev-parse","HEAD");const baseTree=git(root,"rev-parse",`${base}^{tree}`);const scratch=await mkdtemp(join(tmpdir(),"aca-numstat-"));t.after(()=>rm(scratch,{recursive:true,force:true}));
  await writeFile(join(root,"src/a.txt"),"head\nchanged\n");await writeFile(join(root,"added.txt"),"one\ntwo\n");await writeFile(join(root,"binary.bin"),Buffer.from([0,1,2,3]));await rm(join(root,"package.json"));
  const paths=["added.txt","binary.bin","package.json","src/a.txt"];const shot=await captureSnapshot({root,parentCommit:base,baseCommit:base,baseTree,allowedPaths:paths,excludedPrefixes:[],scratchParent:scratch});t.after(()=>shot.cleanup());
  const normalized=[];for(const path of paths){const old=join(root,`.trusted-old-${path.replaceAll("/","-")}`),current=join(root,path);const existed=path!=="added.txt"&&path!=="binary.bin";if(existed)await writeFile(old,spawnSync("/usr/bin/git",["show",`${base}:${path}`],{cwd:root}).stdout);const result=spawnSync("/usr/bin/git",["diff","--no-index","--numstat","--",existed?old:"/dev/null",path==="package.json"?"/dev/null":current],{cwd:root,encoding:"utf8"});assert.ok([0,1].includes(result.status));const [a,d]=result.stdout.trim().split("\t");normalized.push({path,additions:a==="-"?0:Number(a||0),deletions:d==="-"?0:Number(d||0),binary:a==="-"&&d==="-"});await rm(old,{force:true});}
  assert.deepEqual(shot.diff.rows.map(({path,additions,deletions,binary})=>({path,additions,deletions,binary})),normalized);assert.equal(shot.diff.additions,normalized.reduce((n,row)=>n+row.additions,0));assert.equal(shot.diff.deletions,normalized.reduce((n,row)=>n+row.deletions,0));
});

test("large single-file diff has truthful totals and remains 64 KiB streamed",async t=>{const root=await repo(t);const base=git(root,"rev-parse","HEAD");const scratch=await mkdtemp(join(tmpdir(),"aca-large-numstat-"));t.after(()=>rm(scratch,{recursive:true,force:true}));await writeFile(join(root,"src/a.txt"),"line\n".repeat(600));const reads=[];const shot=await captureSnapshot({root,parentCommit:base,baseCommit:base,allowedPaths:["src/a.txt"],excludedPrefixes:[],scratchParent:scratch,observeReadSize:n=>reads.push(n)});t.after(()=>shot.cleanup());assert.equal(shot.diff.additions,600);assert.equal(shot.diff.deletions,1);assert.ok(reads.every(n=>n<=SNAPSHOT_LIMITS.chunkBytes));});
