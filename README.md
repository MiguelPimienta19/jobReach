# jobreach

A CLI tool that turns a job posting URL into a cover letter, personalized LinkedIn outreach messages, and a database of every application — in under a minute.

## How it works

```
jobreach add <url>
```

1. **Scrape** — Playwright fetches the job posting (handles JS-rendered pages)
2. **Parse** — Claude extracts title, company, description, requirements, location
3. **Cover letter** — Claude writes a targeted cover letter in your voice
4. **Recruiter search** — A Claude agent uses the LinkedIn MCP server to find recruiters and university recruiters at the company (runs in parallel with cover letter generation)
5. **Outreach messages** — Personalized LinkedIn messages generated for each contact
6. **Persist** — Everything saved to Supabase (deduplicates by URL)

```
jobreach qa <url> "question"
```

Looks up an already-tracked job from Supabase and answers an application question in your voice, grounded in the stored job context.

---

## Prerequisites

- **Node.js 18+**
- **[uv](https://docs.astral.sh/uv/)** — Python package manager (for the LinkedIn MCP server)
- **Supabase account** — [supabase.com](https://supabase.com), free tier is fine
- **Claude Code** — the tool uses your existing Claude Code subscription via `@anthropic-ai/claude-agent-sdk`; no separate Anthropic API key is needed

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/yourname/jobReach.git
cd jobReach
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your Supabase credentials:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Initialize the database

In your Supabase dashboard, open the **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql). This creates three tables (`jobs`, `contacts`, `messages`) with the right indexes and triggers.

### 4. Install the LinkedIn MCP server

```bash
uv tool install linkedin-scraper-mcp
```

### 5. Log in to LinkedIn

```bash
uv tool run linkedin-scraper-mcp --login
```

This opens a browser for you to log in. Your session is saved locally and reused on subsequent runs. The LinkedIn scraper is what lets the tool find recruiters — skip this step and contact discovery will be skipped.

### 6. Build

```bash
npm run build
```

### 7. Link globally

```bash
npm link
```

Now `jobreach` is available anywhere in your terminal.

---

## Usage

### Add a job posting

```bash
jobreach add "https://jobs.ashbyhq.com/company/role-id"
```

Output includes:
- Parsed job details (title, company, location, salary if listed)
- A ready-to-paste cover letter
- Up to 3 recruiters or university recruiters found on LinkedIn, each with a personalized outreach message

Running the same URL twice is a no-op — the tool checks Supabase before doing any work.

### Answer an application question

```bash
jobreach qa "https://jobs.ashbyhq.com/company/role-id" "What's a technical challenge you've overcome?"
```

The job must already exist in Supabase (added via `jobreach add`). The answer is written in first person using the stored job context and your personal background.

---

## Personalizing output with `context/me.md`

All generated text — cover letters, outreach messages, application answers — is grounded in your background. By default, the tool falls back to a hardcoded stub. To use your own information, create `context/me.md` (this file is git-ignored):

```
context/
└── me.md   ← create this, it's git-ignored
```

Suggested structure:

```markdown
# About me

[2-3 sentences: name, school/company, graduation date or years of experience]

# Projects

**Project Name** — [one sentence: what it is, what it won or achieved]
**Project Name** — [one sentence]

# Stack

[comma-separated list of languages, frameworks, tools]

# Writing voice

[optional: describe how you write — e.g. "direct and confident, no filler phrases, not overly formal"]
```

The file is read at startup. No re-build needed after editing it.

---

## Commands reference

| Command | Arguments | Description |
|---|---|---|
| `jobreach add` | `<url>` | Scrape a job, generate cover letter + outreach, save to Supabase |
| `jobreach qa` | `<url> <question>` | Answer an application question for a tracked job |

---

## Database schema

Three tables in Supabase:

| Table | What it stores |
|---|---|
| `jobs` | Job postings — title, company, description, requirements, cover letter, status |
| `contacts` | Recruiters found per job — name, title, LinkedIn URL, role type |
| `messages` | Outreach messages per contact — content, platform, draft/sent/replied status |

Job status can be: `pending` → `applied` → `interview` → `offer` / `rejected`. Currently managed manually in Supabase; no CLI command for status updates yet.

---

## Tech stack

| Piece | What it does |
|---|---|
| `commander` | CLI argument parsing |
| `playwright` | Headless browser scraping |
| `@anthropic-ai/claude-agent-sdk` | Drives Claude for generation + LinkedIn agent loop |
| `linkedin-scraper-mcp` | MCP server the agent uses to search LinkedIn |
| `@supabase/supabase-js` | Persistence |
| `ora` + `chalk` | Terminal output |
| `tsup` | Build (ESM output) |
