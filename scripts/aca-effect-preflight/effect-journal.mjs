import { open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalJson, createJournalRecord, emptyEffectState, validateAndReduce } from './effect-state.mjs';

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function replayJournal(path) {
  let bytes;
  try { bytes = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return emptyEffectState(); throw error; }
  if (bytes === '') return emptyEffectState();
  if (!bytes.endsWith('\n')) throw new Error('journal has a truncated final line');
  const lines = bytes.slice(0, -1).split('\n');
  if (lines.some(line => line === '')) throw new Error('journal contains an empty line');
  let state = emptyEffectState();
  for (const line of lines) {
    let record;
    try { record = JSON.parse(line); } catch { throw new Error('journal line is malformed'); }
    if (canonicalJson(record) !== line) throw new Error('journal line is noncanonical or has duplicate keys');
    state = validateAndReduce(state, record);
  }
  return state;
}

export async function appendJournal(path, event) {
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    const state = await replayJournal(path);
    const record = createJournalRecord(state, event);
    validateAndReduce(state, record);
    const firstCreation = !(await exists(path));
    const file = await open(path, 'a', 0o600);
    try { await file.write(`${canonicalJson(record)}\n`); await file.sync(); } finally { await file.close(); }
    if (firstCreation) {
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
    return record;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
