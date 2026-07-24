import { execFileSync } from 'node:child_process';

// Returns trimmed stdout, or null if git fails (not a repo, unborn HEAD, etc.)
export function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    }).trim();
  } catch {
    return null;
  }
}
