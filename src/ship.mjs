// Ship-readiness scoring: how close is a project to being publishable,
// and what's still missing. A remote counts as "already shipped".

const CHECKS = [
  { label: 'README', points: 20, pass: (p) => p.hasReadme },
  { label: 'LICENSE', points: 10, pass: (p) => p.hasLicense },
  { label: 'git repo', points: 15, pass: (p) => p.git },
  { label: 'tests', points: 15, pass: (p) => p.hasTests },
  { label: 'manifest', points: 15, pass: (p) => p.hasManifest },
  { label: 'clean tree', points: 10, pass: (p) => p.git && p.dirty === 0 },
  { label: '5+ commits', points: 15, pass: (p) => p.commits >= 5 },
];

export function shipScore(project) {
  let score = 0;
  const missing = [];
  for (const check of CHECKS) {
    if (check.pass(project)) score += check.points;
    else missing.push(check.label);
  }
  return { score, missing };
}

// Unpublished projects (no remote), freshest and most complete first.
export function shipCandidates(projects, { limit = 10, maxStaleDays = 120 } = {}) {
  return projects
    .map((p) => ({ ...p, ...shipScore(p) }))
    .filter((p) => !p.remote && p.staleDays <= maxStaleDays)
    .sort((a, b) => b.score - a.score || a.staleDays - b.staleDays)
    .slice(0, limit);
}

// Repos with uncommitted work — the stuff one bad `rm -rf` loses forever.
export function dirtyRepos(projects) {
  return projects
    .filter((p) => p.dirty > 0)
    .sort((a, b) => b.dirty - a.dirty);
}

// Directories with no version control at all.
export function unversioned(projects) {
  return projects
    .filter((p) => !p.git)
    .sort((a, b) => a.staleDays - b.staleDays);
}
