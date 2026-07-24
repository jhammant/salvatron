// The ledger is salvatron's memory: every snapshot refreshes what's on disk,
// and projects that vanish become tombstones — remembered with their final
// state and remote URL, so cleanup never means amnesia.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function ledgerPath() {
  const dir = process.env.SALVATRON_HOME || join(homedir(), '.salvatron');
  return join(dir, 'ledger.json');
}

export function loadLedger() {
  try {
    return JSON.parse(readFileSync(ledgerPath(), 'utf8'));
  } catch {
    return { updatedAt: null, projects: {} };
  }
}

export function saveLedger(ledger) {
  const path = ledgerPath();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2));
  return path;
}

export function updateLedger(ledger, scanned, root, { now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const seen = new Set();
  const diff = { added: [], returned: [], gone: [], newlyDirty: [], cleaned: [] };

  for (const p of scanned) {
    seen.add(p.path);
    const prev = ledger.projects[p.path];
    if (!prev) diff.added.push(p.name);
    else {
      if (prev.gone) diff.returned.push(p.name);
      if ((prev.dirty ?? 0) === 0 && p.dirty > 0) diff.newlyDirty.push(p.name);
      if ((prev.dirty ?? 0) > 0 && p.dirty === 0) diff.cleaned.push(p.name);
    }
    ledger.projects[p.path] = {
      ...p,
      firstSeen: prev?.firstSeen ?? today,
      lastSeen: today,
      gone: false,
      goneSince: null,
    };
  }

  // Only tombstone entries under the scanned root — scanning one directory
  // must not declare projects elsewhere dead.
  for (const rec of Object.values(ledger.projects)) {
    if (!seen.has(rec.path) && !rec.gone && rec.path.startsWith(root + '/')) {
      rec.gone = true;
      rec.goneSince = today;
      diff.gone.push(rec.name);
    }
  }

  ledger.updatedAt = today;
  return diff;
}

export function tombstones(ledger) {
  return Object.values(ledger.projects)
    .filter((p) => p.gone)
    .sort((a, b) => (b.goneSince ?? '').localeCompare(a.goneSince ?? ''));
}
