import './env.js';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// Client + Model Constants
// ============================================================================

// './env.js' is imported above for its side effect — it loads .env before this
// client is constructed, so process.env.ANTHROPIC_API_KEY is populated in time.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Sonnet for writing where quality matters (cover letter, notes, qa).
export const MODEL_WRITER = 'claude-sonnet-4-6';

// Haiku for structured extraction — JSON parsing, speed > nuance.
export const MODEL_FAST = 'claude-haiku-4-5';
