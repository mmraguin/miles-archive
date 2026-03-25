# miles-archive — Project Reference

*Last updated: March 25, 2026. Intelligent logger update live.*

---

## What This Is

Personal journal and intelligence system for Miles (she/her, Manila, GMT+8). Single-page web app on GitHub Pages. Replaces Day One, Habitify, Daylio, and Apple Notes. One daily conversation with Claude that captures the day, tracks health data, and saves structured markdown to a private GitHub repo.

Live at: `https://mmraguin.github.io/miles-archive/`

---

## This Workspace

```
Miles Intelligence System/
├── CLAUDE.md                    ← this file
├── migration-status.md          ← data migration tracker
├── project.txt                  ← Day One export (~2018–present), pending migration
├── goals/
│   ├── current.md               ← 2026 goals (Life Zones → Outcomes → Milestones)
│   └── archive/
│       ├── 2023.md              ← identity work, breakup recovery
│       ├── 2024.md              ← diagnosis year, health + creative exploration
│       └── 2025.md              ← treatment, home, relationships, music
├── journal/                     ← daily entries uploaded via app
├── Git/                         ← live app files (deploy from here)
│   ├── index.html
│   ├── miles-archive.css
│   └── miles-archive.js
├── New notion goals/            ← processed: Outcome + Milestone CSVs (2023–2026)
└── Exports/                     ← raw data pending migration
    ├── Day One/                 ← mental.txt, notes.txt, Lyrics.txt, Spots.txt
    ├── Garmin/                  ← activities CSV, sleep CSV, menstrual cycles
    ├── Notion/                  ← journal logs, medical tracker, heart health CSVs
    ├── goals/                   ← original Notion goal exports by year (source used)
    └── lab results/             ← lab_results_compiled.csv (full lab history)
```

The repo (`mmraguin/miles-archive`) has its own structure — journal/, summaries/, goals/, habits/, notes/. See Repo Structure below.

---

## Stack

| Layer | Detail |
|---|---|
| Hosting | GitHub Pages, public repo `mmraguin/miles-archive` (app code only) |
| Data | Private repo (configured via `ar_repo` in localStorage) |
| Frontend | Vanilla HTML/CSS/JS — no frameworks, no build step |
| AI | Anthropic API, `claude-sonnet-4-6` |
| Storage | GitHub API (entries + notes), localStorage (credentials + drafts) |
| Fonts | Fraunces (display serif) + DM Sans (body) + DM Mono (mono) |
| Accent | Teal `#4ecdb4` on near-black `#0a0a0a` |

Two-repo architecture: app code lives in public `mmraguin/miles-archive` (GitHub Pages). All journal data, notes, and goals live in a separate private repo. `ar_repo` in config points to the private data repo.

---

## Three-File App

All three files live in repo root. Read all three before changing any one.

| File | Role | Size |
|---|---|---|
| `index.html` | Markup only | ~119 lines |
| `miles-archive.css` | All styles | ~469 lines |
| `miles-archive.js` | All logic | ~1050 lines |

---

## Credentials

No hardcoded keys. Both stored in `localStorage` on each device:

```javascript
const CREDS = {
  get anthropicKey() { return localStorage.getItem('ar_ant')  || ''; },
  get githubToken()  { return localStorage.getItem('ar_gh')   || ''; },
  get repo()         { return localStorage.getItem('ar_repo') || 'mmraguin/miles-archive'; },
};
```

Keys: `ar_ant` (Anthropic), `ar_gh` (GitHub PAT, repo scope), `ar_repo`, `ar_drafts`

Config access: ⚙ button top-right. Anthropic auto-revokes keys found in chat or repos — never share in conversation.

---

## Critical Implementation Details

**API headers — all three required:**
```javascript
'x-api-key': CREDS.anthropicKey,
'anthropic-version': '2023-06-01',
'anthropic-dangerous-direct-browser-access': 'true',  // missing = CORS fail
```

**Max tokens:** `2500` minimum. Full entries run 600–900 tokens output.

**Timezone:** All date logic uses `Asia/Manila` via `Intl.DateTimeFormat`. Never use `Date()` offsets.

**Base64:** Use `TextEncoder`/`TextDecoder`, not `escape()`/`unescape()`.

**Session metadata** (`sessionDate`, `sessionDow`, `sessionDay`) is computed once at start via `_initSessionMeta()`. Do not recompute mid-session.

**Entry markers:** Claude wraps completed entries in `<<<ENTRY_START>>>` / `<<<ENTRY_END>>>`. `extractEntry()` depends on these exact strings.

**iOS:** `touch-action: manipulation` on `*`, `visualViewport` resize listener, `env(safe-area-inset-bottom)` on input, click on `#input-inner` delegates to textarea.

**No native `confirm()`** — uses `inlineConfirm()` with stored callback.

---

## State Object

```javascript
const S = {
  messages:        [],   // full Claude conversation history
  sessionDate:     null, // 'YYYY-MM-DD' Manila
  sessionDow:      null, // 'Tuesday' etc
  sessionDay:      null, // 0–6, 0=Sun
  brief:           false,
  thinking:        false,
  pendingEntry:    null,
  pendingPath:     null,
  existingEntry:   null, // today's full file content from GitHub, if any
  recentEntries:   [],   // [{date, content}] last 3 daily entries, compressed
  stateOfMiles:    null, // fetched from notes/state-of-miles.md
  pendingState:    null, // state doc update pending save
  goals:           null, // fetched from notes/goals-summary.md
  patterns:        null, // fetched from notes/patterns.md
  pendingPatterns: null, // patterns doc update pending save
  deepFetched:     false,// whether FETCH_DEEP has fired this session
  _queuedPatterns: null, // patterns update queued to show after entry bar clears
};
```

---

## System Prompt Architecture

`buildSysPrompt()` joins sections with `\n\n`, filtered for truthiness:

```
identity → context → stateDoc → goalsContext → patternsContext → recentContext → graymatterTrend → trendAwareness → fetchDeep → coaching → briefMode → graymatter → protocol → output → voice → stateUpdate → patternsUpdate → misc
```

`stateDoc` is fetched from `notes/state-of-miles.md` at session start. Update whenever health context changes — diagnoses, meds, labs, open threads. Sat/Sun medication reminders injected here.

`goalsContext` is fetched from `notes/goals-summary.md` — 3–5 line active goals summary. Not the full goals doc. Update when priorities shift. Claude references this during conversation to surface goal connections and flag stagnation. Suppressed on hard days / health flares.

`patternsContext` is fetched from `notes/patterns.md` — Claude's accumulated observations across sessions. Injected as context; Claude uses it without referencing it directly. Updated by Claude via `<<<PATTERNS_START>>>` / `<<<PATTERNS_END>>>` markers at session end. Miles confirms before saving.

`recentContext` is the last 3 daily entries, **compressed** (YAML frontmatter + first paragraph of Narrative only, ~300 tokens per entry). Gives Claude scores and narrative thread without full entry weight.

`graymatterTrend` is parsed from YAML frontmatter of recent entries — compact score table for pattern spotting.

`fetchDeep` section instructs Claude when to emit `<<<FETCH_DEEP>>>` — triggers a background fetch of entries 4–14 days ago, injected compressed into `S.messages` for the next API call. Only fires once per session, never during brief mode.

`briefMode` section only present when `S.brief === true`.
`voice` section always present — sets conversational tone, prohibits markdown in chat, adds HOW TO RESPOND interaction rules.

---

## Health Context — State of Miles Doc

Health context is no longer hardcoded in the system prompt. It's fetched at session start from `notes/state-of-miles.md` in the repo and injected as `stateDoc`.

The template is at `state-of-miles-template.md` in this workspace. Copy it to `notes/state-of-miles.md` in the repo and keep it current — diagnoses, meds, medical team, current focus, open threads, recent labs.

This means health context is always as fresh as the last time you updated the doc, and doesn't require a code change to reflect new information.

---

## Coaching Posture (in system prompt)

Five modes — Claude picks one, never announces it:

| Signal | Mode |
|---|---|
| Low energy / tired / brief | Mindful Observer — quiet, minimal follow-ups |
| Processing something difficult | Nurturing Catalyst → Socratic Guide |
| Repeating pattern / stuck | Direct Truth-Teller — name it plainly |
| Rationalizing / inconsistent | Strategic Provocateur — gentle opposition |
| Reflecting / philosophical | Socratic Guide — follow the thread |

Truth Over Comfort: if narrative and numbers diverge, name it. Don't validate stories that aren't serving her. Distinguish a hard day from a pattern.

---

## Voice & Format (in system prompt)

No markdown in conversational messages. The UI renders `textContent`, not HTML — asterisks and headers show as literal characters. Plain prose only in chat.

Tone: direct, specific, human. Friend who knows medicine and how to ask the right question — not a therapist reading from a script. Explicit avoid list in the `voice` section covers: padding adverbs ("quietly", "deeply"), AI vocabulary ("delve", "leverage", "robust"), negative parallelism ("It's not X. It's Y."), fake suspense ("Here's the thing"), rhetorical self-questions, em-dash overuse, tricolon pileups, signposted conclusions.

Entry output (inside `<<<ENTRY_START>>>` / `<<<ENTRY_END>>>`) still uses markdown — that content is saved to GitHub and intentionally structured.

---

## Entry Save Flow

1. Claude produces entry inside `<<<ENTRY_START>>>` / `<<<ENTRY_END>>>`
2. `extractEntry()` strips markers, entry hidden from display
3. `detectType()` checks entry content (first 300 chars) for type — not reply preamble
4. `pathFor(type, date)` generates GitHub path
5. Save bar appears with path and teal Save button
6. `saveEntry()`: `getFileInfo()` (gets SHA if file exists) → PUT with base64 content
7. Success: system pill, save bar dismisses after 2.4s

**Path mapping:**
```
daily          → journal/daily/YYYY/YYYY-MM-DD.md
weekly         → journal/weekly/YYYY-WNN.md
monthly        → journal/monthly/YYYY-MM.md
psychiatrist   → summaries/psychiatrist/YYYY-MM-DD.md
rheumatologist → summaries/rheumatologist/YYYY-MM-DD.md
goals          → goals/current.md
```

**Save logic** (in `saveEntry()`):
- Claude produces the complete file — YAML frontmatter + all sections — so it's saved wholesale
- `getFileInfo()` returns the existing SHA if the file exists (needed for GitHub PUT)
- For same-day continuation: Claude's merged output replaces the existing file entirely
- Non-daily entries: same behavior, no special handling

---

## Brief Mode

Auto-triggers on:
```javascript
/rough.{0,15}short/i, /keep it short/i, /quick.{0,10}(check|entry)/i,
/just.{0,8}numbers/i, /exhausted/i, /pagod/i, /maikli/i,
/fatiguée/i, /tired.{0,10}tonight/i, /matulog na/i
```

Also toggled via "brief" nav button. Injects `BRIEF MODE ACTIVE` — 2–3 exchanges max before numbers.

Language: Miles uses English, Tagalog, and French interchangeably. Claude follows without comment.

---

## Draft Recovery

Last 3 sessions saved to `localStorage['ar_drafts']`, valid 18 hours. On restore: shows last 3 exchange pairs, earlier messages collapsed to system pill. Full history still in `S.messages`.

---

## Error Handling

`friendlyError(err)` maps to human messages. GitHub errors tagged `github_401`/`github_403` before entering function.

| Error | Message |
|---|---|
| `github_401` | GitHub token invalid — tap ⚙ and update it |
| `github_403` | GitHub token lacks repo permission |
| API `401` | Anthropic API key invalid — tap ⚙ to update |
| `429` | Rate limited — wait a moment and retry |
| `529` | Claude is overloaded — try again in a moment |
| Network | No connection — check your internet |

---

## Design Rules

OLED dark (`#0a0a0a` base, `#111111` surfaces) · Warm off-white text (`#f0ece6` primary) · Teal accent only (`#4ecdb4`) · Fraunces italic for display · DM Mono for labels/status · DM Sans for body/buttons · No assistant message bubble · User bubbles: dark bg, asymmetric radius (20px top, 5px bottom-right) · Pill buttons (30px border-radius) · No new accent colors, new fonts, or heavy shadows.

---

## Daily File Format

```markdown
---
date: YYYY-MM-DD
health:
  [key-value pairs parsed from bevel.ai data — whatever fields she provides]
graymatter:
  energy: X
  pain: X
  sleep_quality: X
  diet: X
  hydration: X
  mood: X
  anxiety: X
  motivation: X
  social: X
  clarity: X
  medications: true/false
  alcohol: true/false
  wind_down: true/false
flags: []
---

## Health
[formatted health content from bevel.ai]

## Narrative
[first-person, specific]

## Graymatter
**Physical** / **Mental/Emotional** / **Behavioral** / **Flags**

## Notes
[optional]
```

YAML and markdown sections are intentionally both present — YAML for machine retrieval, markdown for human reading. No date in section headers. For same-day continuation, Claude produces one merged entry and it overwrites the existing file wholesale.

`parseGraymatter()` reads from YAML frontmatter — finds the `graymatter:` block, parses `key: X` pairs into labeled scores. `buildGraymatterTrend()` uses this automatically.

---

## Repo Structure

Two separate repos after the split:

**Public app repo** (`mmraguin/miles-archive`) — GitHub Pages source:
```
mmraguin/miles-archive/
├── index.html
├── miles-archive.css
└── miles-archive.js
```

**Private data repo** (configured in `ar_repo`) — all journal data:
```
miles-data/                          ← or whatever you name it
├── journal/
│   ├── daily/
│   │   ├── 2025/YYYY-MM-DD.md
│   │   └── 2026/YYYY-MM-DD.md
│   ├── weekly/YYYY-WNN.md
│   └── monthly/YYYY-MM.md
├── summaries/
│   ├── psychiatrist/YYYY-MM-DD.md
│   └── rheumatologist/YYYY-MM-DD.md
├── goals/
│   ├── current.md
│   └── archive/YYYY.md
├── habits/
│   ├── habitify-exports/
│   └── garmin-exports/
└── notes/
    ├── state-of-miles.md            ← health context
    ├── goals-summary.md             ← active goals (3–5 lines, Claude reads this)
    ├── patterns.md                  ← accumulated patterns (Claude maintains)
    └── reflections/
```

---

## What's Not Built Yet

| Feature | Status |
|---|---|
| **Model update** | ✅ Done — `claude-sonnet-4-6` |
| **`detectType` fix** | ✅ Done — checks entry content, not reply preamble |
| **Garmin sync retired** | ✅ Done — replaced by bevel.ai paste flow |
| **bevel.ai paste flow** | ✅ Done — Claude asks for health summary at session start |
| **New daily file format** | ✅ Done — YAML frontmatter + Health + Narrative + Graymatter + Notes |
| **Voice + tone prompt** | ✅ Done — HOW TO RESPOND rules added; no markdown in chat |
| **Pronoun fix** | ✅ Done — she/her throughout |
| **Session memory** | ✅ Done — last 3 entries fetched compressed at session start |
| **State of Miles doc** | ✅ Done — `notes/state-of-miles.md`; auto-update via markers |
| **Graymatter trend** | ✅ Done — YAML scores parsed, injected as trend table |
| **Goals context** | ✅ Done — `notes/goals-summary.md` fetched at session start; active goals injected |
| **Patterns doc** | ✅ Done — `notes/patterns.md` fetched at session start; updated via `<<<PATTERNS_START>>>` / `<<<PATTERNS_END>>>` markers after entry; queued behind entry save bar |
| **Deep context fetch** | ✅ Done — `<<<FETCH_DEEP>>>` marker triggers background fetch of entries 4–14 days ago; compressed and injected into conversation |
| **Intelligent logger** | ✅ Done — unified mode: logging + pattern observation + goal awareness in every session |
| **Private data repo** | ✅ Architecture ready — `ar_repo` config points to private data repo; see migration instructions |
| **Data migration** | Day One exports → journal/daily/; goals ✅ done; see migration-status.md |
| **Clinical Project** | Separate Claude Project for appointment prep — lab_results_compiled.csv is the source |
| **Dashboard** | Trend charts for graymatter scores — build after 3+ months of data |
| **Reflections** | Deeper synthesis docs stored in notes/reflections/ |
| **Sleep study** | Medical — update state-of-miles.md when results are in |

---

## Working Rules

- Read all three app files before changing any of them
- Match existing code style exactly
- Wrap all localStorage in try/catch
- Use `friendlyError()` for all user-facing errors
- Use `addSys()` for system messages
- Do less when in doubt — this is a daily health tool, stability over features
- Debugging: ask for exact error text. GitHub 401 ≠ Anthropic 401.
