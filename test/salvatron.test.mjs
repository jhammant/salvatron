import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
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

test('ledger remembers deleted projects as tombstones', (t) => {
  const root = makeGraveyard();
  const home = mkdtempSync(join(tmpdir(), 'salvatron-home-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  const { loadLedger, saveLedger, updateLedger, tombstones } = awaitImportLedger();
  process.env.SALVATRON_HOME = home;

  const ledger = loadLedger();
  const first = updateLedger(ledger, scanDir(root), root);
  assert.equal(first.added.length, 3);
  saveLedger(ledger);

  rmSync(join(root, 'dirty'), { recursive: true, force: true });

  const again = loadLedger();
  const second = updateLedger(again, scanDir(root), root);
  assert.deepEqual(second.gone, ['dirty']);

  const dead = tombstones(again);
  assert.equal(dead.length, 1);
  assert.equal(dead[0].name, 'dirty');
  assert.ok(dead[0].goneSince, 'tombstone records when it died');
  assert.equal(dead[0].dirty, 2, 'final state is preserved');

  delete process.env.SALVATRON_HOME;
});

test('archive moves projects aside and the ledger never tombstones them', (t) => {
  const root = makeGraveyard();
  const home = mkdtempSync(join(tmpdir(), 'salvatron-home-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    delete process.env.SALVATRON_HOME;
  });

  const { loadLedger, saveLedger, updateLedger, tombstones, archiveProjects, archived } = ledgerMod;
  process.env.SALVATRON_HOME = home;

  const ledger = loadLedger();
  updateLedger(ledger, scanDir(root), root);

  const { moved, skipped } = archiveProjects(ledger, [join(root, 'loose'), join(root, 'nonexistent')]);
  assert.equal(moved.length, 1);
  assert.equal(skipped[0].reason, 'not found');
  assert.ok(existsSync(join(root, 'SalvatronArchive', 'loose')), 'moved into SalvatronArchive');
  saveLedger(ledger);

  // Next sweep: loose is off the scan (archive dir is excluded) but must be
  // recorded as archived, not dead.
  const diff = updateLedger(ledger, scanDir(root), root);
  assert.deepEqual(diff.gone, [], 'archived projects are not tombstoned');
  assert.equal(tombstones(ledger).length, 0);
  assert.equal(archived(ledger)[0].name, 'loose');
  assert.equal(scanDir(root).length, 2, 'SalvatronArchive itself is not scanned');
});

test('aha finds clusters, near-misses and echoes', async () => {
  const { clusters, nearMisses, echoes } = await import('../src/aha.mjs');

  const mk = (name, extra = {}) => ({
    name, path: `/x/${name}`, git: true, remote: false, dirty: 0, commits: 9,
    hasReadme: true, hasLicense: true, hasTests: true, hasManifest: true,
    staleDays: 5, ...extra,
  });

  const projects = [
    mk('glasto'), mk('glasto-infra', { staleDays: 400 }), mk('GlastoBot', { staleDays: 400 }),
    mk('almost-done', { staleDays: 90 }),
    mk('scraper-medic'),
    mk('gym-scraper', { staleDays: 2000 }),
  ];

  const c = clusters(projects);
  assert.equal(c[0].token, 'glasto');
  assert.equal(c[0].names.length, 3);

  const near = nearMisses(projects);
  assert.ok(near.some((p) => p.name === 'almost-done'));

  const e = echoes(projects, [{ name: 'scraper-old', path: '/dead/scraper-old', gone: true }]);
  assert.ok(e.some((x) => x.fresh === 'scraper-medic' && x.echo === 'gym-scraper'));
});

// node:test runs test files as ESM; a tiny sync-looking helper keeps the
// tombstone test readable while the import stays at module scope.
import * as ledgerMod from '../src/ledger.mjs';
function awaitImportLedger() {
  return ledgerMod;
}

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
