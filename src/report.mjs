import { stats } from './scan.mjs';
import { shipCandidates, dirtyRepos, unversioned } from './ship.mjs';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = (s) => c('1', s);
export const red = (s) => c('31', s);
export const green = (s) => c('32', s);
export const yellow = (s) => c('33', s);
export const dim = (s) => c('2', s);

function age(p) {
  if (!Number.isFinite(p.staleDays)) return 'unknown';
  if (p.staleDays === 0) return 'today';
  if (p.staleDays < 30) return `${p.staleDays}d ago`;
  if (p.staleDays < 365) return `${Math.round(p.staleDays / 30)}mo ago`;
  return `${(p.staleDays / 365).toFixed(1)}y ago`;
}

export function renderScan(projects) {
  const s = stats(projects);
  const lines = [];
  lines.push(bold('SALVATRON SWEEP COMPLETE'));
  lines.push('');
  lines.push(`  ${bold(String(s.total))} projects scanned`);
  lines.push(`  ${green(String(s.gitRepos))} under git · ${red(String(s.noGit))} with no version control`);
  lines.push(`  ${red(String(s.dirty))} repos carrying uncommitted work`);
  lines.push(`  ${yellow(String(s.noRemote))} repos with no remote (nowhere but this disk)`);
  lines.push(`  ${dim(String(s.stale180))} untouched for 6+ months`);
  return lines.join('\n');
}

export function renderDirty(projects, limit = 25) {
  const dirty = dirtyRepos(projects).slice(0, limit);
  if (!dirty.length) return green('No uncommitted work found. Suspiciously tidy.');
  const lines = [bold(`UNCOMMITTED WORK — ${dirty.length} repos at risk`), ''];
  for (const p of dirty) {
    lines.push(`  ${red(String(p.dirty).padStart(4))} files  ${bold(p.name)}  ${dim(age(p))}`);
  }
  lines.push('');
  lines.push(dim('One spilled coffee from oblivion. Commit or stash.'));
  return lines.join('\n');
}

export function renderShip(projects, opts) {
  const cands = shipCandidates(projects, opts);
  if (!cands.length) return 'No ship candidates in range. Everything is either published or fossilised.';
  const lines = [bold('SHIP CANDIDATES — closest to launch, not yet published'), ''];
  for (const p of cands) {
    const needs = p.missing.length ? `needs: ${p.missing.join(', ')}` : 'ready';
    lines.push(`  ${green(String(p.score).padStart(3))}/100  ${bold(p.name.padEnd(28))} ${dim(age(p).padEnd(9))} ${yellow(needs)}`);
  }
  return lines.join('\n');
}

export function tyrantLines(projects) {
  const s = stats(projects);
  const lines = [];
  if (s.total > 100) lines.push(`${s.total} projects. This is not a dev directory, it is a garbage dimension.`);
  if (s.dirty > 10) lines.push(`${s.dirty} repos with uncommitted changes. Your work exists at the pleasure of your hardware.`);
  if (s.noGit > 20) lines.push(`${s.noGit} directories with no version control. Bold. Doomed, but bold.`);
  if (s.stale180 > 50) lines.push(`${s.stale180} projects untouched for six months. They dream of being finished.`);
  lines.push('ASSESSMENT COMPLETE. REPORTING NOTHING TO RICK.');
  return lines.map((l) => red(bold(`  ⏣ ${l}`))).join('\n');
}

export function renderReport(projects, { tyrant = false, ...opts } = {}) {
  const parts = [
    renderScan(projects),
    '',
    renderDirty(projects, 10),
    '',
    renderShip(projects, opts),
  ];
  const unv = unversioned(projects);
  if (unv.length) {
    parts.push('');
    parts.push(bold(`NO VERSION CONTROL — ${unv.length} dirs, most recent first`));
    parts.push(unv.slice(0, 10).map((p) => `  ${bold(p.name.padEnd(28))} ${dim(age(p))}`).join('\n'));
  }
  if (tyrant) {
    parts.push('');
    parts.push(tyrantLines(projects));
  }
  return parts.join('\n');
}
