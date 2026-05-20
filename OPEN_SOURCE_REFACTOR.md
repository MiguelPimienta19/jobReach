# Open-Source Refactor Plan


## Design

### `jobreach.config.json` (gitignored)

User-owned config file at the project root. Schema:

```json
{
  "name": "Miguel",
  "school": "University of Oregon",
  "schoolShort": "UO",
  "gradMonth": "June 2026"
}
```

- `name` — first name used in all generation prompts ("Write a cover letter for {name}...")
- `school` — full school name. Used in the alumni search query and ROLE_CONTEXT for the alumni framing. **If absent**, the alumni search slot is replaced with a generalist recruiter search.
- `schoolShort` — short form (e.g., "UO") used in terminal labels and connection note copy. Defaults to `school` if absent.
- `gradMonth` — e.g., "June 2026." **If absent**, university-recruiter framing drops new-grad language and the tool treats the user as an experienced hire.

### `jobreach.config.example.json` (committed)

Template with placeholder values:
```json
{
  "name": "Your First Name",
  "school": "Your University Name",
  "schoolShort": "Short form (e.g. UO)",
  "gradMonth": "Month Year (or leave empty if not a new grad)"
}
```

### Graceful fallback

If `jobreach.config.json` is missing or unparseable, `loadProfile()` prints a one-line warning at startup and uses generic defaults:

```
[jobreach] No jobreach.config.json — using generic placeholders.
            Copy jobreach.config.example.json to jobreach.config.json and edit to personalize.
```

Defaults:
- `name` → "the applicant"
- `school` → undefined (alumni slot becomes generalist recruiter slot)
- `gradMonth` → undefined (drop new-grad framing)

Tool still runs end-to-end with generic output. No hard error.

### `context/me.md` fallback (already partially done)

`generator.ts` already warns if `context/me.md` is missing. Currently it falls back to Miguel's hardcoded bio — that needs to change to a generic placeholder bio:

```
The applicant has not yet configured their background. Write professional, generic
content. Do not invent specific projects, employers, or experiences. Suggest in the
output that the user add details to context/me.md to get personalized generation.
```

That way new users get something usable on first run but are clearly nudged to set up `context/me.md`.

### Templates in `context/`

`context/` is currently fully gitignored, so no `.example` templates can live there. Options:

**Option 1 (recommended):** Loosen the `.gitignore` rule to allow `.example.md` files inside `context/`:
```
context/*.md
!context/*.example.md
```
Then check in `context/me.example.md` and `context/resume.example.md` as placeholder templates with instructions inside.

**Option 2:** Put templates at the repo root (e.g., `me.example.md`) and have setup docs tell users to copy them into `context/`. Simpler gitignore but worse discoverability.

Going with Option 1.

---

## Files to create

1. **`src/lib/profile.ts`** — `loadProfile()` reads `jobreach.config.json`, caches, returns `UserProfile`. Warns + falls back to generic defaults on missing/invalid file.
2. **`jobreach.config.example.json`** — committed template (placeholder values).
3. **`context/me.example.md`** — placeholder bio template with instructions inside ("describe your background, projects, school, and what you're looking for — this gets injected as the system prompt for all generation").

## Files to modify

4. **`.gitignore`** — change `context/` to `context/*.md` + `!context/*.example.md` so example templates can be committed.
5. **`src/lib/agent.ts`** — template `${profile.name}`, `${profile.school}`, `${profile.schoolShort}` into the search prompt. When `profile.school` is undefined, swap turn 2 to a generalist recruiter search instead of an alumni search.
6. **`src/lib/generator.ts`** —
   - Replace the Miguel-specific fallback bio with a generic placeholder
   - Template `${profile.name}` into every prompt that currently hardcodes "Miguel" (lines 152, 159, 181, 203, 214)
   - Template `${profile.school}`, `${profile.schoolShort}`, `${profile.gradMonth}` into ROLE_CONTEXT entries (lines 174–177)
   - Conditional new-grad framing in `university_recruiter` and `engineer` ROLE_CONTEXT — drop new-grad language when `gradMonth` is undefined
7. **`src/commands/add.ts`** — template `${profile.schoolShort}` into the "UO Alum" label (e.g., `${schoolShort} Alum`).
8. **`README.md`** — add a "Setup" section explaining the two config files (`jobreach.config.json` + `context/me.md`).
9. **`CLAUDE.md`** — update the environment section to mention the new config files. Don't bother stripping the existing references — CLAUDE.md is developer-facing project doc, not a user-facing template.

## Out of scope

- `jobreach init` interactive wizard — nice-to-have, separate change. For now users copy `.example` files and edit by hand.
- "Experienced hire" mode beyond just dropping the grad-date framing — the tool's overall slot structure (university recruiters as priority 1) is still new-grad-oriented. Adding a true `careerStage` toggle that rebalances the trio is a bigger feature.
- Cross-job tracker (the dedup-by-company idea from earlier) — separate change.

## Verification

After implementing, sanity check by:
1. Temporarily renaming `jobreach.config.json` and `context/me.md` aside, running `jobreach add <url>` — should print warnings and produce generic-but-coherent output.
2. Restoring the files and running again — should produce identical personalized output to before the refactor.
3. `grep -rn "Miguel\|University of Oregon\|June 2026" src/` should return zero results.

## Estimated effort

Small. ~1 hour of focused work. No architectural risk — pure extraction.
