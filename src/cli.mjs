#!/usr/bin/env node
import { resolve } from 'node:path';
import { scanDir, stats } from './scan.mjs';
import { shipCandidates, dirtyRepos, unversioned, staleProjects } from './ship.mjs';
import {
  loadLedger, saveLedger, updateLedger, tombstones, archiveProjects, archived,
} from './ledger.mjs';
import { ahaMoments } from './aha.mjs';
import {
  renderScan, renderDirty, renderShip, renderStale, renderReport,
  renderAha, renderSnapshot, renderGraveyard,
} from './report.mjs';

const HELP = `salvatron — the salvage bot for AI-assisted development

Usage: salvatron <command> [dir] [options]

Commands:
  scan     Inventory every project: git state, staleness, risk counts
  dirty    Repos with uncommitted work, most at-risk first
  ship     Unpublished projects closest to launch, with what's missing
  stale    Cleanup candidates: untouched for ages, with last-accessed times
  aha      Insights: duplicate-idea clusters, near-misses, rebuild echoes
  snapshot Record this sweep in the ledger; diff vs last time (writes state)
  archive  Move projects into SalvatronArchive/ next to them (ledger remembers)
  graveyard Projects deleted or archived, as remembered in the ledger
  report   The full digest (scan + dirty + ship + unversioned + ah-has)

Options:
  --json          Machine-readable output
  -n <count>      Limit list length (default 10)
  --stale <days>  Max staleness for ship candidates (default 120)
  --tyrant        Let Salvatron say what it really thinks
  -h, --help      This help

[dir] defaults to the current directory. Point it at the graveyard:
  salvatron report ~/dev --tyrant
`;

function parseArgs(argv) {
  const args = { command: null, paths: [], json: false, tyrant: false, limit: 10, maxStaleDays: 120 };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === '-h' || a === '--help') return { help: true };
    else if (a === '--json') args.json = true;
    else if (a === '--tyrant') args.tyrant = true;
    else if (a === '-n') args.limit = Number(rest.shift()) || 10;
    else if (a === '--stale') args.maxStaleDays = Number(rest.shift()) || 120;
    else if (!args.command) args.command = a;
    else args.paths.push(a);
  }
  args.dir = args.paths[0] ?? process.cwd();
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.command) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
}

const NEEDS_SCAN = new Set(['scan', 'dirty', 'ship', 'stale', 'aha', 'snapshot', 'report']);
let projects = [];
if (NEEDS_SCAN.has(args.command)) {
  try {
    projects = scanDir(args.dir);
  } catch (err) {
    console.error(`salvatron: cannot scan ${args.dir}: ${err.message}`);
    process.exit(1);
  }
}

const opts = { limit: args.limit, maxStaleDays: args.maxStaleDays };

switch (args.command) {
  case 'scan':
    if (args.json) console.log(JSON.stringify({ stats: stats(projects), projects }, null, 2));
    else console.log(renderScan(projects));
    break;
  case 'dirty':
    if (args.json) console.log(JSON.stringify(dirtyRepos(projects), null, 2));
    else console.log(renderDirty(projects, args.limit));
    break;
  case 'ship':
    if (args.json) console.log(JSON.stringify(shipCandidates(projects, opts), null, 2));
    else console.log(renderShip(projects, opts));
    break;
  case 'stale':
    if (args.json) console.log(JSON.stringify(staleProjects(projects, { minStaleDays: args.maxStaleDays }), null, 2));
    else console.log(renderStale(projects, { minStaleDays: args.maxStaleDays, limit: args.limit }));
    break;
  case 'aha': {
    const moments = ahaMoments(projects, tombstones(loadLedger()));
    if (args.json) console.log(JSON.stringify(moments, null, 2));
    else console.log(renderAha(moments));
    break;
  }
  case 'snapshot': {
    const ledger = loadLedger();
    const diff = updateLedger(ledger, projects, resolve(args.dir));
    const path = saveLedger(ledger);
    if (args.json) console.log(JSON.stringify({ diff, ledger: path }, null, 2));
    else console.log(renderSnapshot(diff, ledger));
    break;
  }
  case 'archive': {
    if (!args.paths.length) {
      console.error('salvatron: archive needs at least one project path');
      process.exit(1);
    }
    const ledger = loadLedger();
    const result = archiveProjects(ledger, args.paths);
    saveLedger(ledger);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const m of result.moved) console.log(`archived  ${m.name} → ${m.to}`);
      for (const s of result.skipped) console.log(`skipped   ${s.name} (${s.reason})`);
      console.log(`\n${result.moved.length} archived. The ledger remembers them all.`);
    }
    break;
  }
  case 'graveyard': {
    const ledger = loadLedger();
    if (args.json) console.log(JSON.stringify({ dead: tombstones(ledger), archived: archived(ledger) }, null, 2));
    else console.log(renderGraveyard(tombstones(ledger), archived(ledger)));
    break;
  }
  case 'report':
    if (args.json) {
      console.log(JSON.stringify({
        stats: stats(projects),
        dirty: dirtyRepos(projects),
        shipCandidates: shipCandidates(projects, opts),
        unversioned: unversioned(projects),
      }, null, 2));
    } else console.log(renderReport(projects, {
      tyrant: args.tyrant,
      ahas: ahaMoments(projects, tombstones(loadLedger())),
      ...opts,
    }));
    break;
  default:
    console.error(`salvatron: unknown command '${args.command}'\n`);
    console.log(HELP);
    process.exit(1);
}
