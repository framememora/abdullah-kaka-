// Append-only event log, one JSON object per line (JSONL).
//
// Why a flat file: a single counter produces a handful of events an hour. A file
// that is trivially greppable, backup-able and readable without tooling beats a
// database at this scale. See the README for when to graduate to SQLite.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, '..', 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');

// Serialises writes so a rewrite (markNotified) can never interleave with an append
// and lose a record.
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  // Keep the chain alive even if fn rejects, so one failure doesn't wedge the queue.
  queue = run.catch(() => {});
  return run;
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Append one event. Returns the stored record (with its generated id and timestamp).
 */
export async function appendEvent(event) {
  const record = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    ...event,
  };

  await exclusive(async () => {
    await ensureDir();
    await fs.appendFile(EVENTS_FILE, `${JSON.stringify(record)}\n`, 'utf8');
  });

  return record;
}

/**
 * Read events, newest first. A single malformed line is skipped rather than
 * allowed to take down the whole dashboard.
 */
export async function readEvents({ limit = 500 } = {}) {
  let raw;
  try {
    raw = await fs.readFile(EVENTS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return []; // nothing recorded yet
    throw err;
  }

  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Truncated or corrupt line — ignore it and keep going.
    }
  }

  events.reverse();
  return limit > 0 ? events.slice(0, limit) : events;
}

/**
 * Record the outcome of the WhatsApp notification for one event.
 * Read-patch-rewrite via a temp file + rename, so a crash mid-write cannot leave
 * a half-written log behind.
 */
export async function markNotified(id, notified) {
  return exclusive(async () => {
    let raw;
    try {
      raw = await fs.readFile(EVENTS_FILE, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }

    let found = false;
    const lines = raw.split('\n').map((line) => {
      if (!line.trim() || found) return line;
      try {
        const evt = JSON.parse(line);
        if (evt.id !== id) return line;
        found = true;
        return JSON.stringify({ ...evt, notified });
      } catch {
        return line;
      }
    });

    if (!found) return false;

    const tmp = `${EVENTS_FILE}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, lines.join('\n'), 'utf8');
    await fs.rename(tmp, EVENTS_FILE);
    return true;
  });
}

export const paths = { DATA_DIR, EVENTS_FILE };
