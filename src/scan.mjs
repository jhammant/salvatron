import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { git } from './git.mjs';

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'setup.py', 'requirements.txt',
  'Cargo.toml', 'go.mod', 'Gemfile', 'Package.swift', 'pom.xml',
  'build.gradle', 'Makefile', 'CMakeLists.txt',
];
const TEST_MARKERS = ['test', 'tests', '__tests__', 'spec'];
const LICENSES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'];

const MS_PER_DAY = 86_400_000;

function anyExists(dir, names) {
  return names.some((n) => existsSync(join(dir, n)));
}

function hasReadme(dir) {
  try {
    return readdirSync(dir).some((f) => /^readme(\.|$)/i.test(f));
  } catch {
    return false;
  }
}

export function scanProject(path, { now = Date.now() } = {}) {
  const p = {
    name: basename(path),
    path,
    git: existsSync(join(path, '.git')),
    remote: false,
    dirty: 0,
    commits: 0,
    lastActivity: null,
    hasReadme: hasReadme(path),
    hasLicense: anyExists(path, LICENSES),
    hasTests: anyExists(path, TEST_MARKERS),
    hasManifest: anyExists(path, MANIFESTS),
  };

  if (p.git) {
    const status = git(path, ['status', '--porcelain']);
    p.dirty = status ? status.split('\n').filter(Boolean).length : 0;
    p.remote = Boolean(git(path, ['remote']));
    p.commits = Number(git(path, ['rev-list', '--count', 'HEAD'])) || 0;
    p.lastActivity = git(path, ['log', '-1', '--format=%cs']) || null;
  }

  if (!p.lastActivity) {
    try {
      p.lastActivity = statSync(path).mtime.toISOString().slice(0, 10);
    } catch {
      p.lastActivity = null;
    }
  }

  p.staleDays = p.lastActivity
    ? Math.max(0, Math.floor((now - Date.parse(p.lastActivity)) / MS_PER_DAY))
    : Infinity;

  return p;
}

export function scanDir(root, opts = {}) {
  const abs = resolve(root);
  const entries = readdirSync(abs, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && !e.name.startsWith('.'),
  );

  const projects = [];
  for (const e of entries) {
    try {
      projects.push(scanProject(join(abs, e.name), opts));
    } catch {
      // unreadable dir — skip, never crash the sweep
    }
  }
  return projects.sort((a, b) =>
    (a.lastActivity ?? '').localeCompare(b.lastActivity ?? ''),
  );
}

export function stats(projects) {
  return {
    total: projects.length,
    gitRepos: projects.filter((p) => p.git).length,
    noGit: projects.filter((p) => !p.git).length,
    dirty: projects.filter((p) => p.dirty > 0).length,
    noRemote: projects.filter((p) => p.git && !p.remote).length,
    stale180: projects.filter((p) => p.staleDays >= 180).length,
  };
}
