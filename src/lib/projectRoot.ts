import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ============================================================================
// Project Root Discovery
// ============================================================================

// When jobreach is installed globally, git-ignored files like .env,
// jobreach.config.json, and context/me.md don't end up in the install dir.
// We need to find the user's actual project root.
//
// Search order:
//   1. JOBREACH_HOME env var (explicit override)
//   2. Walk up from process.cwd() (works when CWD is inside the project)
//   3. Walk up from this module's own location (with `npm link`, this
//      resolves to the real project dir via the symlink)
//   4. Return undefined — caller falls back to script-relative paths

const WALK_UP_LIMIT = 8;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function walkUp(startDir: string, marker: string): string | undefined {
  let dir = startDir;

  for (let i = 0; i < WALK_UP_LIMIT; i++) {
    if (existsSync(join(dir, marker))) {
      return dir;
    }

    const parent = dirname(dir);

    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  return undefined;
}

export function findProjectRoot(marker: string): string | undefined {
  if (process.env.JOBREACH_HOME) {
    const envCandidate = join(process.env.JOBREACH_HOME, marker);

    if (existsSync(envCandidate)) {
      return process.env.JOBREACH_HOME;
    }
  }

  const fromCwd = walkUp(process.cwd(), marker);

  if (fromCwd) {
    return fromCwd;
  }

  const fromScript = walkUp(__dirname, marker);

  if (fromScript) {
    return fromScript;
  }

  return undefined;
}
