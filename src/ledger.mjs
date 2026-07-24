// The ledger is salvatron's memory: every snapshot refreshes what's on disk,
// and projects that vanish become tombstones — remembered with their final
// state and remote URL, so cleanup never means amnesia.

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { homedir } from 'node:os';

export const ARCHIVE_DIRNAME = 'SalvatronArchive';

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
    if (!seen.has(rec.path) && !rec.gone && !rec.archived && rec.path.startsWith(root + '/')) {
      rec.gone = true;
      rec.goneSince = today;
      diff.gone.push(rec.name);
    }
  }

  ledger.updatedAt = today;
  return diff;
}

// Move projects into a sibling SalvatronArchive/ dir and record it in the
// ledger as archived — aged out, still on disk, never confused with dead.
export function archiveProjects(ledger, paths, { now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const moved = [];
  const skipped = [];
  for (const target of paths) {
    const from = resolve(target);
    if (!existsSync(from)) {
      skipped.push({ name: basename(from), reason: 'not found' });
      continue;
    }
    const to = join(dirname(from), ARCHIVE_DIRNAME, basename(from));
    if (existsSync(to)) {
      skipped.push({ name: basename(from), reason: 'already archived' });
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    const rec = ledger.projects[from] ?? { name: basename(from), path: from };
    ledger.projects[from] = {
      ...rec,
      archived: true,
      archivedTo: to,
      archivedOn: today,
      gone: false,
      goneSince: null,
    };
    moved.push({ name: basename(from), to });
  }
  return { moved, skipped };
}

export function archived(ledger) {
  return Object.values(ledger.projects)
    .filter((p) => p.archived && !p.gone)
    .sort((a, b) => (b.archivedOn ?? '').localeCompare(a.archivedOn ?? ''));
}

export function tombstones(ledger) {
  return Object.values(ledger.projects)
    .filter((p) => p.gone)
    .sort((a, b) => (b.goneSince ?? '').localeCompare(a.goneSince ?? ''));
}
