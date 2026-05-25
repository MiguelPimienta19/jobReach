import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { findProjectRoot } from './projectRoot.js';

// ============================================================================
// Dotenv side-effect load
// ============================================================================

// Loaded for its side effect: populates process.env from the project's .env file.
// Imported at the top of any module that reads process.env at construction time
// (notably src/lib/anthropic.ts, where the Anthropic client captures the API key
// when it's instantiated).
//
// In ESM, all `import` statements in a file run before any non-import code, so
// putting the dotenv call in src/index.ts after the imports was too late — the
// Anthropic client was already constructed with an undefined apiKey.

const envRoot = findProjectRoot('.env');

if (envRoot) {
  loadDotenv({ path: join(envRoot, '.env') });
} else {
  loadDotenv();
}
