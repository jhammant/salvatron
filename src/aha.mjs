// Heuristic "ah ha" moments: deterministic insights mined from the scan and
// ledger. No LLM, no network — just patterns you stopped being able to see.

import { shipCandidates } from './ship.mjs';

const STOP = new Set([
  'app', 'apps', 'test', 'demo', 'the', 'new', 'old', 'video', 'site',
  'bot', 'tool', 'tools', 'skill', 'cli', 'ios', 'web', 'lite', 'pro',
  'ops', 'lab', 'setup', 'config', 'promo', 'infra',
]);

export function nameTokens(name) {
  return [
    ...new Set(
      name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((t) => t.length >= 3 && !STOP.has(t)),
    ),
  ];
}

// Projects sharing a distinctive name token — one idea, many directories.
export function clusters(projects, { min = 3 } = {}) {
  const byToken = new Map();
  for (const p of projects) {
    for (const t of nameTokens(p.name)) {
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(p.name);
    }
  }
  return [...byToken.entries()]
    .filter(([, names]) => names.length >= min)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([token, names]) => ({ token, names }));
}

// Nearly shippable and sitting still: one push from done, for months.
export function nearMisses(projects, { minScore = 80, minStaleDays = 60 } = {}) {
  return shipCandidates(projects, { limit: 1000, maxStaleDays: 10_000 })
    .filter((p) => p.score >= minScore && p.staleDays >= minStaleDays);
}

// A fresh project that rhymes with an old or dead one — a probable rebuild.
export function echoes(projects, tombstoned = []) {
  const recent = projects.filter((p) => p.staleDays <= 30);
  const old = [
    ...projects.filter((p) => p.staleDays >= 180),
    ...tombstoned,
  ];
  const found = [];
  for (const r of recent) {
    const rTokens = new Set(nameTokens(r.name));
    for (const o of old) {
      if (o.path === r.path) continue;
      const shared = nameTokens(o.name).filter((t) => rTokens.has(t));
      if (shared.length) {
        found.push({
          fresh: r.name,
          echo: o.name,
          token: shared[0],
          gone: Boolean(o.gone),
        });
        break;
      }
    }
  }
  return found;
}

export function ahaMoments(projects, tombstoned = []) {
  const moments = [];

  for (const c of clusters(projects).slice(0, 4)) {
    moments.push(
      `${c.names.length} projects orbit "${c.token}": ${c.names.join(', ')}. One idea — which is canonical?`,
    );
  }

  for (const p of nearMisses(projects).slice(0, 3)) {
    const months = Math.round(p.staleDays / 30);
    moments.push(
      `${p.name} is ${p.score}/100 shippable (needs: ${p.missing.join(', ')}) and has sat still for ${months} month${months === 1 ? '' : 's'}.`,
    );
  }

  for (const e of echoes(projects, tombstoned).slice(0, 3)) {
    moments.push(
      e.gone
        ? `${e.fresh} echoes ${e.echo} — which you already built and deleted. The ledger remembers it.`
        : `${e.fresh} echoes ${e.echo}, untouched for 6+ months. Salvage before you rebuild.`,
    );
  }

  return moments;
}
