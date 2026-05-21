import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
const CONFIG_PATH = join(__dirname, '../../jobreach.config.json');

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
