# Open-Source Refactor Plan

Make jobreach usable by anyone, not just Miguel. Goal: a new user clones the repo, copies `.example` files, fills in their own info, and the tool runs end-to-end with personalized output for *them*.

---

## The two layers of personalization

1. **Identity** — name, school, grad date. Small, structured. Lives in `jobreach.config.json`.
2. **Voice & background** — bio, projects, resume, writing samples, targets. Long-form. Lives in `context/*.md`.

Both layers must have `.example` templates committed to the repo and gitignored real versions.

---

## File: `jobreach.config.json` (gitignored)

User-owned config at the project root.

```json
{
  "name": "Miguel",
  "school": "University of Oregon",
  "schoolShort": "UO",
  "gradMonth": "June 2026"
}
```

- `name` — first name used in every generation prompt
- `school` — full school name. Used in the alumni search query and in `ROLE_CONTEXT.alumni`. **If absent**, the alumni search slot is replaced with a generalist recruiter search and the alumni role type is dropped from the trio.
- `schoolShort` — short form (e.g., "UO") for terminal labels and connection-note copy. Defaults to `school` if absent.
- `gradMonth` — e.g., "June 2026." **If absent**, university-recruiter framing drops new-grad language and the tool treats the user as an experienced hire.

## File: `jobreach.config.example.json` (committed)

```json
{
  "name": "Your First Name",
  "school": "Your University (or remove this line if not a student)",
  "schoolShort": "Short form (e.g. UO)",
  "gradMonth": "Month Year (or remove this line if not a new grad)"
}
```

## Graceful fallback

If `jobreach.config.json` is missing or unparseable, `loadProfile()` prints a one-line warning at startup and uses generic defaults:

```
[jobreach] No jobreach.config.json — using generic placeholders.
            Copy jobreach.config.example.json to jobreach.config.json and edit to personalize.
```

Defaults:
- `name` → "the applicant"
- `school` → undefined (alumni slot becomes generalist recruiter slot)
- `gradMonth` → undefined (drop new-grad framing)

Tool runs end-to-end with generic output. No hard error.

---

## Context files (gitignored real, committed examples)

The `context/` folder holds long-form personalization. Four files, all loaded into every generation prompt:

| File | Purpose |
|---|---|
| `me.md` | Bio, voice rules, writing style — the canonical voice anchor |
| `resume.md` | Specific bullets, metrics, dates, stacks |
| `writing-samples.md` | Real cover letters + connection notes for tone calibration |
| `targets.md` | What kinds of roles/companies, soft preferences |

### Loader (Priority 5 from NEXT_STEPS.md — fold this in)

In `src/lib/generator.ts`, replace the current single-file `me.md` load with a multi-file loader:

```ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTEXT_FILES = ['me.md', 'resume.md', 'writing-samples.md', 'targets.md'];

function loadContext(): string {
  const base = join(__dirname, '../../context');
  return CONTEXT_FILES
    .filter(f => existsSync(join(base, f)))
    .map(f => readFileSync(join(base, f), 'utf-8'))
    .join('\n\n---\n\n');
}

const contextFile = loadContext();

if (!contextFile.trim()) {
  console.warn('\n[jobreach] No context files found in context/ — using built-in generic fallback bio.\n            Copy context/*.example.md to context/*.md and edit to personalize.\n');
}
```

Remove the old `contextPath` / `contextExists` / `contextFile` lines.

### Generic fallback bio (replace Miguel-specific one in `src/lib/generator.ts:40`)

Current fallback hardcodes Miguel's bio. Replace with:

```ts
${contextFile || `The applicant has not yet configured their background. Write professional, generic content. Do not invent specific projects, employers, or experiences. In the output, briefly note that the user should add details to context/me.md to get personalized generation.`}
```

### `.gitignore` update

Currently `context/` is fully gitignored. Loosen to allow `.example.md` files:

```
context/*.md
!context/*.example.md
```

### Example files to commit

Each `.example.md` is a placeholder template with instructions inside (already mostly done — the current `context/*.md` files were *originally* templates before Miguel filled them in). Build the templates fresh, **don't ship Miguel's real content** as the example:

- **`context/me.example.md`** — bio template with sections: Background (placeholder), Projects (placeholder), Experience (placeholder), Tech Stack (placeholder), Personal (5 short prompts: "what you find interesting about software", "what you're learning right now", "outside of code", "why you chose your major", optional fifth), Voice and Tone (keep the rules generic — short sentences, no em-dashes, no semicolons, plain facts, but drop Miguel's specific examples), Writing Rules.
- **`context/resume.example.md`** — section skeleton (Education, Experience, Projects, Skills, Awards, Leadership) with `[bracketed placeholders]` for every field.
- **`context/writing-samples.example.md`** — empty section skeleton (Cover Letter Sample 1/2/3, Connection Note Sample 1/2/3) with one short instruction paragraph at the top explaining what to paste.
- **`context/targets.example.md`** — role-type priorities, company-type yes/no/open, locations, dream-companies list — all brackets.

---

## Hardcoded references to template

These are the exact lines that currently hardcode Miguel/UO/June 2026. Each must use `profile.name` / `profile.school` / `profile.schoolShort` / `profile.gradMonth` from `loadProfile()` instead.

### `src/lib/generator.ts`
- **Line 40** (fallback bio): replace with the generic version above
- **Line 152**: `Write a cover letter for Miguel applying to...` → `Write a cover letter for ${profile.name} applying to...`
- **Line 159**: `the 1-2 most relevant projects from Miguel's background` → `from ${profile.name}'s background`
- **Line 174** (`recruiter` ROLE_CONTEXT): `Name the specific role Miguel applied to` → `${profile.name} applied to`
- **Line 175** (`university_recruiter` ROLE_CONTEXT): hardcodes "Miguel graduating June 2026." Template `${profile.name} graduating ${profile.gradMonth}`. **If `gradMonth` is undefined, drop the "graduating X" clause AND the new-grad framing entirely** — switch to "experienced hire" wording.
- **Line 176** (`alumni` ROLE_CONTEXT): hardcodes "University of Oregon alum" and "shared UO background." Template `${profile.school} alum` and `shared ${profile.schoolShort} background`. **If `school` is undefined, this role type should not be used — handled at the agent.ts level by replacing the alumni search slot with a generalist recruiter search.**
- **Line 177** (`engineer` ROLE_CONTEXT): "one specific, relevant project of Miguel's" → `${profile.name}'s`
- **Line 181** (connection note prompt): `from Miguel to ${contact.name}` → `from ${profile.name} to ${contact.name}`
- **Line 203**: `Answer this application question for Miguel` → `for ${profile.name}`
- **Line 214**: `Write in first person as Miguel` → `as ${profile.name}`

### `src/lib/agent.ts`
- **Line 58**: `Find up to 3 people at "${company}" who can help Miguel (a University of Oregon new grad)...` → `who can help ${profile.name} (a ${profile.school}${profile.gradMonth ? ' new grad' : ''})...`. If no `school` or `gradMonth`, drop both qualifiers.
- **Line 64**: `A University of Oregon alum (any role) — roleType: "alumni"` → `A ${profile.school} alum...`. **If `profile.school` is undefined, replace this turn with a generalist recruiter search** and don't ask the agent for an alumni contact.

### `src/commands/add.ts`
- **Line 158**: `alumni: chalk.cyan('UO Alum')` → `alumni: chalk.cyan(\`${profile.schoolShort} Alum\`)`. Pass profile in or read it inline.

---

## Files to create

1. **`src/lib/profile.ts`** — `loadProfile()` reads `jobreach.config.json`, caches the result, returns a `UserProfile` type. Warns + falls back to generic defaults on missing/invalid file. Exports a `UserProfile` interface.
2. **`jobreach.config.example.json`** — committed template (placeholder values, see above)
3. **`context/me.example.md`** — placeholder bio template (see Example files section above)
4. **`context/resume.example.md`** — placeholder resume skeleton
5. **`context/writing-samples.example.md`** — placeholder samples skeleton
6. **`context/targets.example.md`** — placeholder targets skeleton

## Files to modify

7. **`.gitignore`** — change `context/` to `context/*.md` + `!context/*.example.md`. Add `jobreach.config.json`.
8. **`src/lib/generator.ts`** — multi-file loader (replaces single-file `me.md` load), generic fallback bio, template every `Miguel`/`June 2026`/`University of Oregon`/`UO` reference (see line list above)
9. **`src/lib/agent.ts`** — template `profile.name`, `profile.school`, `profile.schoolShort`, `profile.gradMonth` into the search prompt; conditional alumni → generalist recruiter swap when `school` is undefined
10. **`src/commands/add.ts`** — template the `UO Alum` label
11. **`README.md`** — new "Setup" section explaining the two config layers (`jobreach.config.json` + `context/*.md`). Remove the existing inline `context/me.md` instructions and point at the `.example` files instead.
12. **`CLAUDE.md`** — update the Environment section to mention the new config files. Note that the loader now reads all four context files. Update the "currently only loads me.md" line.

---

## Verification (run after the refactor)

1. **Generic mode** — temporarily rename `jobreach.config.json` and the four `context/*.md` files aside. Run `jobreach add <url>`. Expected: a startup warning, cover letter that uses generic placeholders ("the applicant"), no alumni contact attempted, generic-but-coherent output, no hard error.
2. **Personalized mode** — restore the files. Run `jobreach add <url>` again. Expected: identical output to before the refactor (modulo nondeterministic generation).
3. **Grep check** — `grep -rn "Miguel\|University of Oregon\|June 2026\|UO Alum" src/` should return zero results.
4. **Partial-config mode** — set `jobreach.config.json` to `{"name": "Alex"}` only (no school, no gradMonth). Run `jobreach add <url>`. Expected: warnings about missing school/gradMonth, alumni search slot replaced with generalist recruiter, no "new grad" language in the university-recruiter framing.

---

## Out of scope

- `jobreach init` interactive wizard — nice-to-have, separate change. For now users copy `.example` files manually.
- "Experienced hire" mode beyond just dropping the grad-date framing. The tool's overall slot structure (university recruiters as priority 1) is still new-grad-oriented. Adding a true `careerStage` toggle that rebalances the trio is a bigger feature.
- Cross-job tracker (dedup contacts by company) — separate change.

---

## Estimated effort

~1.5 hours of focused work. No architectural risk — pure extraction + templating.
