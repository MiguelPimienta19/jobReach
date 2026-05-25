import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { findProjectRoot } from './projectRoot.js';

// ============================================================================
// Types
// ============================================================================

export interface UserProfile {
  name: string;
  school?: string;
  schoolShort?: string;
  gradMonth?: string;
}

interface RawConfig {
  name?: unknown;
  school?: unknown;
  schoolShort?: unknown;
  gradMonth?: unknown;
}

// ============================================================================
// Module Setup
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path differs between dev (src/lib/) and built (dist/). Also handles the
// `npm install -g .` case where the install dir doesn't contain git-ignored
// files — walks up from CWD or honors JOBREACH_HOME.
function findConfigPath(): string {
  const fromProject = findProjectRoot('jobreach.config.json');

  if (fromProject) {
    return join(fromProject, 'jobreach.config.json');
  }

  const fallbacks = [
    join(__dirname, '../jobreach.config.json'),
    join(__dirname, '../../jobreach.config.json'),
  ];

  for (const c of fallbacks) {
    if (existsSync(c)) {
      return c;
    }
  }

  return fallbacks[1];
}

const CONFIG_PATH = findConfigPath();

let cached: UserProfile | null = null;

// ============================================================================
// Loader
// ============================================================================

function asString(v: unknown): string | undefined {
  if (typeof v !== 'string') {
    return undefined;
  }

  const trimmed = v.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

export function loadProfile(): UserProfile {
  if (cached) {
    return cached;
  }

  if (!existsSync(CONFIG_PATH)) {
    console.warn('\n[jobreach] No jobreach.config.json — using generic placeholders.\n            Copy jobreach.config.example.json to jobreach.config.json and edit to personalize.\n');
    cached = { name: 'the applicant' };
    return cached;
  }

  let raw: RawConfig;

  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as RawConfig;
  } catch (e) {
    console.warn(`\n[jobreach] jobreach.config.json could not be parsed (${e instanceof Error ? e.message : 'unknown error'}) — using generic placeholders.\n`);
    cached = { name: 'the applicant' };
    return cached;
  }

  const name = asString(raw.name) ?? 'the applicant';
  const school = asString(raw.school);
  const schoolShort = asString(raw.schoolShort) ?? school;
  const gradMonth = asString(raw.gradMonth);

  cached = {
    name,
    school,
    schoolShort,
    gradMonth,
  };

  return cached;
}
