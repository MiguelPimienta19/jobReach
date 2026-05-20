# LinkedIn Search Slimdown

Trim token usage in the LinkedIn contact discovery loop, and reshape the contact trio for a new-grad outreach strategy.

## Goal

- Cut `findPeopleAtCompany` from ~40–80k tokens per run down to ~15–25k.
- Return a balanced trio per job, optimized for a new grad:
  - **University recruiter** — owns new-grad reqs, highest reply rate
  - **University of Oregon alum** — warm intro, can refer (falls back to a generalist recruiter if no alum is found)
  - **Engineer on the team** — referral path (engineer referrals usually skip the resume screen, motivated by referral bonuses)
- Stop pulling whole employee rosters into context.

## Why this works

- `get_company_employees` returns large employee lists; every subsequent turn re-carries that blob. Dropping it removes the single biggest source of token bloat.
- `search_people` returns a smaller, more relevant result set per call.
- Structuring the prompt as "do exactly these three searches" lets the model finish in 3 turns instead of meandering.
- Restricting `allowedTools` to just `search_people` also shrinks the tool-schema block sent every turn.
- Drops generalist-recruiter-by-default: at most companies generalist recruiters filter out new grads because their reqs require YOE. Only used as the alum fallback.

## Files changing

### 1. `src/types.ts`
Add `'alumni'` and `'engineer'` to `RoleType`:
```ts
export type RoleType = 'recruiter' | 'university_recruiter' | 'alumni' | 'engineer';
```

### 2. `src/lib/agent.ts`
- Rewrite the prompt to direct three specific `search_people` calls:
  - Turn 1: university recruiter
  - Turn 2: UO alum → fallback to generalist recruiter only if no alum found
  - Turn 3: an engineer/IC on the team behind the role (for referral)
- Add `allowedTools: ['mcp__linkedin__search_people']` so `get_company_employees` is not exposed (schema savings).
- Keep `maxTurns: 3`.
- Expand `VALID_ROLE_TYPES` to include `'alumni'` and `'engineer'`.

### 3. `src/lib/generator.ts`
Add `alumni` and `engineer` entries to `ROLE_CONTEXT` for the connection note generator:
- **alumni**: warm-intro framing — shared UO background, ask for a quick chat or referral. Different from recruiter framing.
- **engineer**: referral-ask framing — lead with one specific, relevant project, ask if they'd refer Miguel. Don't pitch the company back to them.

### 4. `src/commands/add.ts`
Add labels for `alumni` (cyan "UO Alum") and `engineer` (yellow "Engineer (Referral)") to the `roleLabel` map in `printSummary`.

## Out of scope (next change)

- Cross-job tracker: when adding a job, detect prior applications at the same company and offer to reuse existing contacts or find net-new people. Separate change.

## Expected impact

- LinkedIn step: ~40–80k → ~15–25k tokens per run (rough estimate; depends on `search_people` response size).
- Better contact mix for a new grad: program pipeline (recruiter) + warm intro (alum) + referral (engineer).
- No DB migration needed — `role_type` is stored as a text column.
