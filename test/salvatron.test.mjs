import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanDir, scanProject, stats } from '../src/scan.mjs';
import { shipScore, shipCandidates, dirtyRepos, unversioned, staleProjects } from '../src/ship.mjs';

function sh(cwd, cmd, cmdArgs) {
  execFileSync(cmd, cmdArgs, { cwd, stdio: 'ignore' });
}

function gitInit(dir) {
  sh(dir, 'git', ['init', '-q']);
  sh(dir, 'git', ['config', 'user.email', 'test@test.invalid']);
  sh(dir, 'git', ['config', 'user.name', 'test']);
}

function commit(dir, msg) {
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['commit', '-q', '-m', msg, '--no-gpg-sign']);
}

// Fixture graveyard: one shippable repo, one dirty repo, one unversioned dir.
function makeGraveyard() {
  const root = mkdtempSync(join(tmpdir(), 'salvatron-'));

  const shippable = join(root, 'shippable');
  mkdirSync(shippable);
  writeFileSync(join(shippable, 'README.md'), '# shippable');
  writeFileSync(join(shippable, 'LICENSE'), 'MIT');
  writeFileSync(join(shippable, 'package.json'), '{}');
  mkdirSync(join(shippable, 'test'));
  writeFileSync(join(shippable, 'test', 'x.test.js'), '');
  gitInit(shippable);
  for (let i = 0; i < 5; i++) {
    writeFileSync(join(shippable, `f${i}.js`), String(i));
    commit(shippable, `commit ${i}`);
  }

  const dirty = join(root, 'dirty');
  mkdirSync(dirty);
  gitInit(dirty);
  writeFileSync(join(dirty, 'a.js'), '1');
  commit(dirty, 'initial');
  writeFileSync(join(dirty, 'a.js'), '2');
  writeFileSync(join(dirty, 'b.js'), 'new');

  mkdirSync(join(root, 'loose'));
  writeFileSync(join(root, 'loose', 'notes.txt'), 'no git here');

  return root;
}

test('salvatron end-to-end on a fixture graveyard', (t) => {
  const root = makeGraveyard();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const projects = scanDir(root);
  assert.equal(projects.length, 3);

  const s = stats(projects);
  assert.equal(s.gitRepos, 2);
  assert.equal(s.noGit, 1);
  assert.equal(s.dirty, 1);
  assert.equal(s.noRemote, 2);

  const byName = Object.fromEntries(projects.map((p) => [p.name, p]));

  assert.equal(byName.shippable.commits, 5);
  assert.equal(byName.shippable.dirty, 0);
  assert.ok(byName.shippable.hasReadme);
  assert.ok(byName.shippable.hasTests);

  assert.equal(byName.dirty.dirty, 2, 'one modified + one untracked file');
  assert.ok(!byName.loose.git);

  const { score, missing } = shipScore(byName.shippable);
  assert.equal(score, 100);
  assert.deepEqual(missing, []);

  const cands = shipCandidates(projects, { maxStaleDays: 365 });
  assert.equal(cands[0].name, 'shippable', 'most shippable ranks first');

  assert.equal(dirtyRepos(projects).length, 1);
  assert.equal(unversioned(projects).length, 1);
  assert.equal(unversioned(projects)[0].name, 'loose');
});

test('lastAccessed is populated and staleProjects filters by modification age', (t) => {
  const root = makeGraveyard();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const projects = scanDir(root);
  for (const p of projects) {
    assert.ok(p.lastAccessed, `${p.name} has a lastAccessed date`);
    assert.equal(typeof p.accessDays, 'number');
    assert.ok(p.accessDays <= 1, 'fixture files were just created, so accessed now');
  }

  // Fixtures are brand new — nothing should qualify as stale.
  assert.equal(staleProjects(projects, { minStaleDays: 180 }).length, 0);

  // Fabricated old projects rank least-recently-accessed first.
  const old = [
    { name: 'deadest', staleDays: 900, accessDays: 800 },
    { name: 'consulted', staleDays: 900, accessDays: 5 },
    { name: 'fresh', staleDays: 10, accessDays: 1 },
  ];
  const stale = staleProjects(old, { minStaleDays: 180 });
  assert.deepEqual(stale.map((p) => p.name), ['deadest', 'consulted']);
});

test('scanProject survives a repo with no commits', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'salvatron-empty-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const empty = join(root, 'empty');
  mkdirSync(empty);
  gitInit(empty);

  const p = scanProject(empty);
  assert.equal(p.commits, 0);
  assert.ok(p.lastActivity, 'falls back to directory mtime');
});

test('CLI runs and produces the report', (t) => {
  const root = makeGraveyard();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const out = execFileSync(process.execPath, [
    new URL('../src/cli.mjs', import.meta.url).pathname,
    'report', root, '--json',
  ], { encoding: 'utf8' });

  const report = JSON.parse(out);
  assert.equal(report.stats.total, 3);
  assert.equal(report.dirty.length, 1);
  assert.equal(report.unversioned.length, 1);
});
