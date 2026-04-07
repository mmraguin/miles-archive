# miles-archive — Project Reference

*Last updated: April 7, 2026. fetchDeep window narrowed 4–14 → 4–10 days. `getSysPrompt()` memoization added (`S._cachedSysPrompt`) — system prompt built once per session, cache invalidated on state/patterns/goals/insights saves. `sendMsg` max_tokens raised to 4096. `S._deepContext` added for ephemeral deep-fetch injection.*

---

## What This Is

Personal journal and intelligence system for Miles (she/her, Manila, GMT+8). Two-page web app on GitHub Pages. Replaces Day One, Habitify, Daylio, and Apple Notes. One daily conversation with Claude that captures the day, tracks health data, and saves structured markdown to a private GitHub repo. Separate dashboard surfaces trends, patterns, and AI observations across time.

Chat: `https://mmraguin.github.io/miles-archive/`
Dashboard: `https://mmraguin.github.io/miles-archive/dashboard.html`

---

## This Workspace

App repo (`mmraguin/miles-archive`) — GitHub Pages source, six files:

```
miles-archive/
├── CLAUDE.md                    ← this file
├── index.html
├── dashboard.html
├── miles-archive.css
├── miles-archive.js
└── garmin_sync.py               ← retired, no longer used
```

All journal data, notes, and goals live in the private data repo. See Repo Structure below.

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

## Four-File App

All four files live in repo root. Read all relevant files before changing any one.

| File | Role |
|---|---|
| `index.html` | Chat page markup |
| `dashboard.html` | Dashboard page markup — shares CSS + JS, calls `initDash()` |
| `miles-archive.css` | All styles (chat + dashboard) |
| `miles-archive.js` | All logic (chat session + dashboard) |

`init()` at the bottom of `miles-archive.js` is guarded: only runs if `#app` exists (index.html). Dashboard calls `initDash()` explicitly. Don't remove that guard.

---

## Credentials

No hardcoded keys. Both stored in `localStorage` on each device:

```javascript
const CREDS = {
  get anthropicKey() { return localStorage.getItem('ar_ant')  || ''; },
  get githubToken()  { return localStorage.getItem('ar_gh')   || ''; },
  get repo()         { return localStorage.getItem('ar_repo') || ''; },
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

**Max tokens:** `2500` default parameter in `callClaude()` (optional 4th param `maxTokens`). Main `sendMsg` call passes `4096`. Post-entry review uses `3500`. Full entries run 600–900 tokens output.

**System prompt memoization:** `getSysPrompt()` wraps `buildSysPrompt()` — builds once per session, stores in `S._cachedSysPrompt`. Invalidated (set to `null`) when state.md, patterns.md, goals-summary.md, or chat-insights.md are saved mid-session. Cleared on session reset.

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
  messages:              [],    // full Claude conversation history
  sessionDate:           null,  // 'YYYY-MM-DD' Manila
  sessionDow:            null,  // 'Tuesday' etc
  sessionDay:            null,  // 0–6, 0=Sun
  brief:                 false,
  thinking:              false,
  reviewMode:            false, // true when Review nav button activated
  pendingEntry:          null,
  pendingPath:           null,
  existingEntry:         null,  // today's full file content from GitHub, if any
  recentEntries:         [],    // [{date, content}] last 3 daily entries, compressed
  stateOfMiles:          null,  // fetched from notes/state-of-miles.md
  pendingState:          null,  // state doc update pending save
  goals:                 null,  // fetched from notes/goals-summary.md
  patterns:              null,  // fetched from notes/patterns.md
  pendingPatterns:       null,  // patterns doc update pending save
  pendingGoalsSummary:   null,  // goals summary update pending save
  chatInsights:          null,  // fetched from notes/chat-insights.md
  pendingInsights:       null,  // chat insights update pending save
  peopleNotes:           null,  // fetched from notes/people-notes.md
  pendingPeopleNotes:    null,  // people notes update pending save
  reviewLog:             null,  // fetched from goals/review-log.md
  pendingReview:         null,  // review entry pending save
  existingReview:        null,  // current review-log.md content (for incomplete merge)
  deepFetched:           false, // whether FETCH_DEEP has fired this session
  _queuedPatterns:       null,  // patterns update queued to show after entry bar clears
  _queuedGoalsSummary:   null,  // goals summary queued after patterns bar clears
  _queuedInsights:       null,  // insights update queued after patterns bar clears
  _queuedPeopleNotes:    null,  // people notes queued after people bar clears
  peopleProfile:         null,  // fetched from notes/people-profile.md
  pendingPeople:         null,  // people profile update pending save
  evolution:             null,  // fetched from notes/evolution.md
  pendingEvolution:      null,  // evolution update pending save
  evoTrigger:            false, // whether evolution entry should be prompted this session
  _queuedPeople:         null,  // people update queued after patterns bar clears
  _queuedEvolution:      null,  // evolution update queued after people bar clears
  reflections:           null,  // fetched from notes/reflections.md
  pendingReflections:    null,  // reflections entry pending save
  _queuedReflections:    null,  // reflections queued after evolution bar clears
  _reviewFired:          false, // prevents duplicate post-save review calls per session
  _reviewRunning:        false, // true while background patterns review call is in flight
  _deepContext:          null,  // ephemeral deep-fetch context — appended to next user message, then cleared
  _cachedSysPrompt:      null,  // memoized system prompt — cleared when context docs change mid-session
};
```

---

## System Prompt Architecture

`buildSysPrompt()` joins sections with `\n\n`, filtered for truthiness. Wrapped by `getSysPrompt()` which memoizes the result in `S._cachedSysPrompt` for the session:

```
identity → context → stateDoc → goalsContext → patternsContext → chatInsightsContext → peopleNotesContext → peopleContext → recentContext → graymatterTrend → reflectionTrend → trendAwareness → sessionOpeners → fetchDeep → coaching → reviewOverdue → briefMode → reflectionElicitation → graymatter → protocol → output → voice → stateUpdate → patternsUpdate → goalsSummaryUpdate → chatInsightsUpdate → peopleNotesUpdate → peopleUpdate → evolutionUpdate → reflectionsUpdate → misc
```

`stateDoc` is fetched from `notes/state-of-miles.md` at session start. Update whenever health context changes — diagnoses, meds, labs, open threads. Sat/Sun medication reminders injected here.

`goalsContext` is fetched from `notes/goals-summary.md` — 3–5 line active goals summary with optional trajectory markers. Not the full goals doc. Claude references this during conversation to surface goal connections and flag stagnation. Suppressed on hard days / health flares. Claude writes it back via `<<<GOALS_SUMMARY_START>>>` markers: always at end of review sessions; conservatively in daily sessions (14-day gate + stagnation/drift threshold, or if confirmed patterns directly contradict a listed goal).

`patternsContext` is fetched from `notes/patterns.md` — Claude's accumulated observations across sessions. Injected as context; Claude uses it without referencing it directly. Updated two ways: (1) Claude may output markers in the main session reply; (2) `triggerPostEntryReview()` fires a background call after every entry or review save using `buildPatternsReviewPrompt()` with merge-mode output (only changed sections). Miles confirms before saving either way.

`chatInsightsContext` is fetched from `notes/chat-insights.md` — named observations, open threads, and reflective insights captured across sessions. Claude updates it via `<<<CHAT_INSIGHTS_START>>>` / `<<<CHAT_INSIGHTS_END>>>` markers when a named experience surfaces, a realization is articulated, or Miles signals something is worth keeping. New entries prepend to the top of their section (newest first). Claude infers intent — no special syntax required. Queued to save after patterns bar in the cascade.

`peopleContext` is fetched from `notes/people-profile.md` — YAML ledger of people in Miles's life. Claude updates it via `<<<PEOPLE_START>>>` / `<<<PEOPLE_END>>>` markers when named people are mentioned. Queued to save after patterns bar. Dashboard reads this for the Inner Circle section.

`evolutionUpdate` is injected only when 90+ days have passed since the last evolution entry (or no entry exists), and at least 7 days since last offered. Claude writes a life phase summary via `<<<EVOLUTION_START>>>` / `<<<EVOLUTION_END>>>` markers. Dashboard reads this for the Evolution section.

`reflectionTrend` is built by `buildReflectionTrend()` from `parseReflection()` output on the last 3 daily entries — compact 3-line context string showing what Miles was grateful for, what she won, and what she remembered each day. Injected after `graymatterTrend`.

`reflectionElicitation` instructs Claude to infer gratitude/wins/memory organically from the session narrative, confirm each with Miles conversationally before writing the entry, and ask directly (briefly, warmly) if signal is missing. Never fabricate.

`reflectionsUpdate` provides the `<<<REFLECTIONS_START>>>` / `<<<REFLECTIONS_END>>>` template. Claude outputs exactly three lines (one per type: `#gratitude`, `#win`, `#memory`), each prefixed with `[[YYYY-MM-DD]]` and wikilinked content — one item per type, specificity over quantity. `mergeReflectionsUpdate()` prepends each line to its section (`## Gratitude`, `## Wins`, `## Memory`) — newest first. Queued last in the save chain, after evolution.

`recentContext` is the last 3 daily entries, **compressed** (YAML frontmatter + first paragraph of Narrative only, ~300 tokens per entry). Gives Claude scores and narrative thread without full entry weight.

`graymatterTrend` is parsed from YAML frontmatter of recent entries — compact score table for pattern spotting.

`fetchDeep` section instructs Claude when to emit `<<<FETCH_DEEP>>>` — triggers a background fetch of entries 4–10 days ago via `fetchDeepEntries()`. Results stored in `S._deepContext` and appended to the next outgoing user message (not stored in `S.messages`). Only fires once per session (`deepFetched` guard), never during brief mode.

`briefMode` section only present when `S.brief === true`.
`voice` section always present — sets conversational tone, prohibits markdown in chat, adds HOW TO RESPOND interaction rules.

---

## Health Context — State of Miles Doc

Health context is no longer hardcoded in the system prompt. It's fetched at session start from `notes/state-of-miles.md` in the repo and injected as `stateDoc`.

Keep `notes/state-of-miles.md` current — diagnoses, meds, medical team, current focus, open threads, recent labs.

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

## Save Bar Chain

Save bars queue in order. Each bar shows only after the previous is saved or dismissed.

**Daily mode:**
```
entry → patterns → goals-summary → insights → people → people-notes → evolution → reflections
```

**Review mode:**
```
review → goals-summary → people-notes → people-profile
```

- Entry / Review bar: always first. `showSaveBar()` / `showReviewBar()`
- Patterns bar: queued via `S._queuedPatterns` if entry is present (daily only)
- Goals-summary bar: queued via `S._queuedGoalsSummary` if entry or patterns is present (teal accent)
- Insights bar: queued via `S._queuedInsights` if entry, patterns, or goals-summary is present; lavender (`#a78bfa`) accent
- People-notes bar: queued via `S._queuedPeopleNotes` after people; rose accent
- People bar: queued via `S._queuedPeople` if earlier bars are present
- Evolution bar: queued via `S._queuedEvolution` after people-notes
- Reflections bar: queued via `S._queuedReflections` — always last in daily mode; saves to `notes/reflections.md` via merge (prepend-only)

If only one type is present (e.g. people with no entry), it shows immediately.

After entry or review saves, `triggerPostEntryReview()` fires in the background. If it produces a patterns update not already in the queue, pat-bar appears after the existing cascade completes.

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
reflection:
  gratitude:
    - "[specific item — not generic]"
  wins:
    - "[something Miles did, completed, or moved forward — small is fine]"
  memory: "[one sentence — a moment, image, or feeling worth holding]"
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

## Reflection
**Gratitude**
- [specific item]

**Wins**
- [specific win]

**Memory**
[one sentence]
```

YAML and markdown sections are intentionally both present — YAML for machine retrieval, markdown for human reading. No date in section headers. For same-day continuation, Claude produces one merged entry and it overwrites the existing file wholesale.

`parseGraymatter()` reads from YAML frontmatter — finds the `graymatter:` block, parses `key: X` pairs into labeled scores. `buildGraymatterTrend()` uses this automatically.

---

## Repo Structure

**Private data repo** (configured in `ar_repo`):
```
miles-data/
├── journal/
│   └── daily/
│       ├── 2024/YYYY-MM-DD.md
│       ├── 2025/YYYY-MM-DD.md
│       └── 2026/YYYY-MM-DD.md
├── goals/
│   ├── current.md
│   ├── review-log.md                ← review session log (planned, created on first write)
│   └── archive/
│       ├── 2023.md
│       ├── 2024.md
│       └── 2025.md
└── notes/
    ├── state-of-miles.md            ← health context
    ├── goals-summary.md             ← active goals (3–5 lines, Claude reads this)
    ├── patterns.md                  ← accumulated patterns (Claude maintains)
    ├── chat-insights.md             ← named observations + open threads (Claude maintains)
    ├── people-profile.md            ← people YAML ledger (Claude maintains, created on first write)
    ├── people-notes.md              ← richer per-person narratives (Claude maintains, created on first write)
    ├── evolution.md                 ← quarterly life phase entries (Claude maintains, created on first write)
    └── reflections.md               ← gratitude/wins/memory running log (Claude maintains, created on first write)
```

---

## Dashboard

`dashboard.html` — separate page, shares `miles-archive.css` and `miles-archive.js`. Calls `initDash()` on load.

**Data sources (all fetched in parallel on load):**
- Last 14 daily entries: YAML graymatter scores + boolean fields (alcohol, medications, wind_down)
- `notes/patterns.md`
- `notes/people-profile.md`
- `notes/evolution.md`

**Computed locally (no API):**
- Per-metric averages + trend directions (↑/↓/→)
- Pentagon radar SVGs (Physical: Energy/Pain/Sleep/Diet/Hydration; Mental: Mood/Anxiety/Motivation/Social/Clarity)
- Score bars with sparklines
- Emotional Almanac: mood average by day-of-week heatmap
- Behavioral correlations: alcohol/wind-down boolean vs next-day metric deltas (min 4 pairs, min 0.4 delta to surface)
- People velocity: Active (mentioned ≤14 days), Quiet (15–90 days), Fading (90+ days) — medical/professional types excluded

**Haiku API call (cached):**
- Cache key: `ar_dash_cache` in localStorage, keyed to `{lastEntryDate}_{entryCount}`
- Only regenerates when new entries have been saved since last generation
- Output: OVERVIEW (one Co-Star sentence), OBS1-3 (observations), MISSION1-3 (prescriptions), BLIND_SPOT
- Parsed from structured prefixes in Haiku's response
- `dashRefresh()` clears cache and reloads

**People YAML format (`notes/people-profile.md`):**
```yaml
---
last_updated: YYYY-MM-DD
---
people:
  - name: Sarah
    relationship: friend
    type: regular
    sessions_mentioned: 14
    last_mentioned: YYYY-MM-DD
    themes: [music, anxiety, support]
```
`type: medical` or `type: professional` excludes from velocity logic. Dashboard shows only people with `sessions_mentioned >= 3`.

**Evolution format (`notes/evolution.md`):**
```markdown
---
last_updated: YYYY-MM-DD
---

## YYYY-MM-DD
**Phase: [name]**

[narrative paragraphs — preserved verbatim across updates]
```
New entries prepend; previous entries preserved below. Dashboard shows the 3 most recent.

---

## Working Rules

- Read all four app files before changing any of them
- Match existing code style exactly
- Wrap all localStorage in try/catch
- Use `friendlyError()` for all user-facing errors
- Use `addSys()` for system messages
- Do less when in doubt — this is a daily health tool, stability over features
- Debugging: ask for exact error text. GitHub 401 ≠ Anthropic 401.
