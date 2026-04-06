# miles-archive — Roadmap

*Last updated: 2026-04-06*

This file tracks feature status and planned work. Update it when features ship, stall, or get scoped. Each entry links to its spec section below when implementation details exist.

---

## In Progress

*(nothing currently)*

---

## Planned

*(nothing currently — all features shipped)*

---

## Backlog

- [ ] **Clinical summaries** — paths for `summaries/psychiatrist/` and `summaries/rheumatologist/` exist but unused. Could be activated with a dedicated session type or explicit trigger phrase.
- [ ] **Dashboard: people-notes integration** — once people-notes ships, surface relationship narratives in the Inner Circle section alongside velocity data.
- [ ] **Dashboard: review-log integration** — show last review date and key next steps on dashboard.

---

## Completed

- [x] **Daily journal entry capture** — Claude conversation → `<<<ENTRY_START>>>` markers → save to `journal/daily/YYYY/YYYY-MM-DD.md`
- [x] **Health score tracking** — 10 graymatter metrics (energy, pain, sleep, diet, hydration, mood, anxiety, motivation, social, clarity) + 3 booleans in YAML frontmatter
- [x] **Same-day continuation** — Claude produces merged file; save overwrites existing entry wholesale
- [x] **State of Miles injection** — health context fetched fresh from `notes/state-of-miles.md` at session start; not hardcoded
- [x] **Patterns doc** — Claude-maintained `notes/patterns.md` via `<<<PATTERNS_START>>>` markers; user confirms before save
- [x] **Brief mode** — auto-triggered by keywords (exhausted, pagod, maikli, etc.) + manual nav button toggle
- [x] **Draft recovery** — last 3 sessions in localStorage, 18-hour validity; restored on revisit
- [x] **Multi-language support** — English, Tagalog, French; Claude follows without comment
- [x] **iOS optimizations** — viewport resize, safe-area-inset-bottom, touch-action manipulation, input delegation
- [x] **Deep context fetch** — `<<<FETCH_DEEP>>>` marker triggers background load of entries 4–14 days ago; injected compressed into next API call
- [x] **Config overlay** — ⚙ button for Anthropic key, GitHub PAT, repo config
- [x] **Fetch overlay** — pull arbitrary repo files into chat context
- [x] **Dashboard** — separate analytics page; 14-day graymatter trends, pentagon radars, score sparklines, emotional almanac, behavioral correlations, Haiku AI insights (cached) *(Mar 1, 2026)*
- [x] **People profile** — `notes/people-profile.md` YAML ledger; Claude-maintained via `<<<PEOPLE_START>>>` markers; dashboard Inner Circle section *(Mar 1, 2026)*
- [x] **Evolution entries** — `notes/evolution.md` quarterly life phase summaries; 90-day trigger; prepend structure; dashboard Evolution section *(Mar 1, 2026)*
- [x] **Chat insights** — `notes/chat-insights.md` named observations + open threads; Claude infers when to update; explicit trigger on save phrases *(Mar 26, 2026)*
- [x] **Past-midnight session date** — `_initSessionMeta()` now checks Manila hour; if < 3am, resolves to previous day *(Apr 5, 2026)*
- [x] **Dashboard tone** — `generateDashInsights()` system prompt updated with full Co-Star voice rules and avoid list *(Apr 5, 2026)*
- [x] **People Notes** — `notes/people-notes.md` with markers, save bar (rose accent), context injection, cascade position after people-profile *(Apr 5, 2026)*
- [x] **Goals summary maintenance** — `notes/goals-summary.md` write path via `<<<GOALS_SUMMARY_START>>>` markers; save bar (teal); conservative daily trigger; `GOALS_SUMMARY_UPDATES` block in system prompt *(Apr 5, 2026)*
- [x] **Review Mode** — `initReviewMode()` fetches all review context; `buildReviewPrompt()` separate system prompt; `<<<REVIEW_START>>>` / `<<<REVIEW_END>>>` markers; `saveReview()` merges incomplete entries; cascade `review → goals-summary → people → people-notes`; amber save bar; review nav button; overdue prompt in daily sessions *(Apr 5, 2026)*
- [x] **Evolution optimization** — entry quality prompt draws from patterns + people-notes + state-of-miles; post-review evolution suggestion when 90+ days since last entry; dashboard shows last evolution date in section header *(Apr 5, 2026)*
- [x] **Auto-update patterns.md** — `triggerPostEntryReview()` fires after every entry save (and review save). Separate focused API call (Sonnet, 3500 tokens) with merge-mode output: only changed sections output, `mergePatternsUpdate()` splices them into existing doc. Silent fail; user confirms before save. ~$0.019/session. *(Apr 5, 2026)*
- [x] **System prompt + data file audit** — chat-insights anchor integrity rule added (Return Threads must match existing ## sections); `## Open Threads` naming bug fixed; session summary depth increased (12→20 msgs, 500→800 chars); goals-summary trajectory markers added (locked vocabulary); contradiction trigger added to daily goals-summary update logic; review mode goalsSummary instruction strengthened to produce quarter-specific lines + Review Log Summary section. Data files repaired: review-log.md paragraph breaks, typo, bullet formatting, PWD card contradiction; chat-insights orphaned Return Threads removed/resolved, missing sections created; goals-summary rewritten with Q2-specific active focuses. *(Apr 5, 2026)*
- [x] **patterns.md restructure + Obsidian wikilinks** — flattened from 6 `##`/`###` hierarchy to 28 flat `##` sections with bold group labels (**HEALTH**, **BEHAVIORAL**, **EMOTIONAL**, **GOALS**, **WINS**, **THREADS**); each section is now an independent merge unit; `## Declined` stub added for new-section insertion; all notes/ dates converted to `[[YYYY-MM-DD]]` wikilink format; chat-insights Return Threads converted to `[[#Section Name|label]]`; app prompts updated to produce new structure and date format *(Apr 6, 2026)*
- [x] **Daily reflection tracking** — gratitude (1–3 specifics), wins (1–3 items), and one memory per session. Claude infers from narrative and confirms conversationally; asks directly if signal is weak. Data stored two ways: `reflection:` YAML block in frontmatter (machine-parseable for dashboard trends) + `## Reflection` prose section in daily entry. Running log in `notes/reflections.md` — Obsidian graph-optimized with `[[wikilinks]]` for people/themes/goal zones and `#gratitude` / `#win` / `#memory` tags. `parseReflection()` + `buildReflectionTrend()` inject last 3 days' reflection context into system prompt. Reflections save bar queued last in cascade. `buildPatternsReviewPrompt()` updated to track gratitude/win/memory themes across sessions *(Apr 6, 2026)*

---

## Feature Specs

### Auto-Update Patterns.md

**Problem:** Patterns doc only updated when Claude spontaneously outputs markers in the main session reply — inconsistent due to token budget pressure and conservative update thresholds.

**Fix:** `triggerPostEntryReview()` fires after `saveEntry()` and `saveReview()` succeed. Separate `callClaude()` call with `buildPatternsReviewPrompt()` and `maxTokens: 3500`.

**Merge mode:** Claude outputs only changed `## Section` blocks tagged with `MERGE_MODE: true`. `mergePatternsUpdate()` splices them into the existing doc. Unchanged sections preserved verbatim. Typical output: 300–600 tokens.

**Guards:** `_reviewFired` / `_reviewRunning` prevent double-fires. Session date check discards results if new session started before call returns. Silently discards if main session already queued patterns.

**Scope:** Patterns only. Chat-insights stays explicit-trigger (Miles signals in-session).

---

### Review Mode

**Purpose:** A distinct session type (not a daily journal) where Claude acts as a life coach — evaluating goal alignment, surfacing gaps, wins, challenges, opportunities, and suggesting next steps or new goals/habits.

**Trigger:** "Review" nav button (pill, same style as Brief). Once review mode starts it does not mix with a daily session. A session is either one or the other.

**Claude prompts when overdue:** During daily sessions, if last review was >14 days ago, Claude mentions it naturally (not intrusively).

**Context fetched at review start:**
- `goals/current.md` — full goals doc
- `notes/goals-summary.md` — active goals summary
- `notes/patterns.md` — accumulated observations
- `notes/chat-insights.md` — named insights + open threads
- `notes/people-notes.md` — relationship narratives *(new, see People Notes below)*
- `notes/evolution.md` — recent quarterly entries (phase context)
- Last 3–5 daily entries (compressed: YAML + first Narrative paragraph)

**Depth:** Adapts to signal from user. "Just a quick check" → check-in format. No signal or full intent → full structured pass.

**Output markers:** `<<<REVIEW_START>>>` / `<<<REVIEW_END>>>`

**Save path:** `goals/review-log.md` — single append file, dated blocks.

**Entry format:**
```markdown
## YYYY-MM-DD
**Status: complete**
**Type: full**

### Alignment
...

### Gaps & Challenges
...

### Wins
...

### Opportunities & Next Steps
...

### New Goals / Habits to Consider
...
```

**Edge cases:**

| Scenario | Behavior |
|---|---|
| User bails mid-session | Claude marks `Status: incomplete`, save bar still appears, entry saved with flag |
| Quick check-in | Claude detects signal, produces shorter format, `Type: check-in` in header |
| Second session on incomplete review | App detects `Status: incomplete` in last entry, injects prior content into system prompt, Claude continues and completes. Save overwrites the incomplete block. |
| Review + daily in same session | Not allowed — modes are distinct. Starting review does not produce a daily entry. |

**State variables to add:**
- `S.reviewMode` — boolean
- `S.pendingReview` — extracted review content
- `S.existingReview` — current `review-log.md` content (for incomplete merge check)
- `S._queuedReview` — queued save bar

**New functions:**
- `initReviewMode()` — fetch all review context, build review system prompt
- `extractReview()` — parse `<<<REVIEW_START>>>` / `<<<REVIEW_END>>>`
- `saveReview()` — fetch SHA, merge incomplete or append new block to `review-log.md`
- `mergeReviewEntry()` — detect incomplete last entry, replace with completed version
- `showReviewBar()` — review save bar (warm amber `#f59e0b` accent)

**Save cascade in review mode:** review → goals-summary → people-notes → people-profile

---

### People Notes

**Purpose:** Richer per-person narratives. The YAML ledger (`people-profile.md`) stays lean — presence, frequency, themes. This file holds the texture: how relationships have evolved, emotional quality, recurring dynamics.

**File:** `notes/people-notes.md` — Claude-maintained, created on first write.

**Markers:** `<<<PEOPLE_NOTES_START>>>` / `<<<PEOPLE_NOTES_END>>>`

**Format:**
```markdown
---
last_updated: YYYY-MM-DD
---

## [Name]
*Relationship: [type] | Last updated: YYYY-MM-DD*

[Narrative paragraphs — how the relationship has evolved, recurring themes, emotional texture]

---
```

**When Claude updates it:**
- During daily sessions when a named person has a notable moment (not every routine mention)
- During review sessions when relationship patterns surface

**Context injection:** Fed into daily sessions and review sessions. Not injected on brief mode.

**Save bar:** Queued after people-profile in cascade. Distinct accent TBD (soft rose or matches lavender of insights bar).

**State variables to add:**
- `S.peopleNotes` — loaded content
- `S.pendingPeopleNotes` — pending save
- `S._queuedPeopleNotes` — queued save bar

---

### Evolution Optimization

**Hard differences from Review — do not conflate:**

| | Evolution | Review |
|---|---|---|
| Lens | Observational, non-judgmental | Evaluative, goal-referenced |
| Trigger | 90-day time window | User-initiated + overdue prompt |
| Output | "This is who I am becoming" | "This is how I'm doing" |
| Contains | Mindset shifts, physical state, life phase changes | Alignment, gaps, wins, next steps |
| Tone | Historical record | Coaching session |
| Prescriptive | No | Yes |
| References goals | Incidentally | Explicitly |

**Improvements to make:**
1. **Entry quality** — Claude should draw from `notes/patterns.md`, `notes/people-notes.md`, and `notes/state-of-miles.md` when writing evolution entries, not just the current conversation.
2. **Review integration** — After a review session, if 90+ days since last evolution entry, Claude suggests it separately: *"This might be worth logging as a phase moment — want to do an evolution entry?"* Not automatic. Keeps them distinct.
3. **Dashboard** — Evolution entries already surfaced (3 most recent). Consider also showing last evolution date in review context to help Claude calibrate how much time has passed since last phase reflection.

---

### Dashboard Tone

**Problem:** The dashboard AI insights (generated by Haiku, parsed from OVERVIEW / OBS1-3 / MISSION1-3 / BLIND_SPOT) read like an academic health report — detached, third-person, analytical. The voice should match Co-Star: direct, second-person, spare, slightly oracular. Talking *to* Miles, not *about* her data.

**What to change:** The Haiku prompt in `buildDashPrompt()` (or equivalent). No structural changes to parsing — the prefix format (OVERVIEW:, OBS1:, etc.) stays the same. Only the prompt instructions and output voice change.

**Target voice:**
- Second-person throughout ("You've been…", "Your energy…")
- No hedging language ("it appears that", "it may be worth noting")
- No academic framing ("analysis indicates", "data suggests")
- Short, declarative sentences — Co-Star doesn't explain, it observes
- Slightly poetic but never flowery — precise over evocative
- No bullet-point logic inside sentences ("X, Y, and Z all point to…")

**Reference:** The existing `voice` section in the daily system prompt has the full avoid list (padding adverbs, AI vocabulary, negative parallelism, fake suspense, rhetorical self-questions, em-dash overuse, tricolon pileups). Apply those same rules to the Haiku prompt.

**Scope:** Prompt change only. No UI, no parsing, no structural changes.

---

### Goals Summary Maintenance

**Problem:** `notes/goals-summary.md` is the only way goals enter the daily session system prompt — `goals/current.md` is never injected. But the file has no app write path, so it silently drifts until manually updated. `goals/current.md` stays human-maintained (it's a values and identity doc); the summary is just a condensed read of it and should auto-maintain.

**Markers:** `<<<GOALS_SUMMARY_START>>>` / `<<<GOALS_SUMMARY_END>>>`

**Format:**
```markdown
# Active Goals Summary

*Last updated: YYYY-MM-DD*
*Full goals: goals/current.md*

- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
```

4–5 lines maximum. Each line is one active focus area — specific enough for Claude to recognize when a journal entry connects to it or contradicts it. Not a values statement; not a full milestone list. What's actively in motion right now.

**Trigger cases:**

| Case | When | Notes |
|---|---|---|
| Post-review | End of every Review session | Review produces goal alignment analysis — updating the summary is the natural capstone. Always fires in review mode. |
| Daily drift | Daily session, conservatively | Only if patterns show the current summary is materially out of date: a listed goal has been stagnant 8+ weeks with no movement, or a new focus has emerged from 4+ weeks of patterns that isn't reflected. Not a routine update. |

**When not to trigger in daily sessions:** If the summary was updated in the last 14 days, skip. If the session is brief mode, skip. If nothing in today's session or recent patterns contradicts what's in the summary, skip.

**Save placement:**
- *Review mode:* First in cascade after the review-log entry. `review → goals-summary → people-notes → people-profile`
- *Daily mode:* After patterns in the cascade. `entry → patterns → goals-summary (if triggered) → insights → people → evolution`

**New functions:**
- `extractGoalsSummary()` — parse `<<<GOALS_SUMMARY_START>>>` / `<<<GOALS_SUMMARY_END>>>`
- `saveGoalsSummary()` — fetch SHA, commit to `notes/goals-summary.md`
- `showGoalsSummaryBar()` — save bar (accent: same teal as patterns bar, or distinct — TBD)

**State variables to add:**
- `S.pendingGoalsSummary` — extracted content pending save
- `S._queuedGoalsSummary` — queued save bar

**System prompt change:** Add `GOALS_SUMMARY_UPDATES` block with trigger rules above. In review mode, make it explicit that updating the summary is expected output. In daily mode, frame it as a conservative correction only.

**Relationship to Review Mode spec:** Update Review Mode save cascade from `review → people notes → people profile` to `review → goals-summary → people-notes → people-profile`.

---

### Past-Midnight Session Date

**Problem:** When Miles logs a session between midnight and 3am, `_initSessionMeta()` resolves to the current calendar date — but the entry belongs to the previous day. A session at 1:30am on April 6 should produce a file named `2026-04-05.md`.

**Fix:** In `_initSessionMeta()`, after computing the Manila date, check if the current Manila hour is < 3. If so, subtract one day before setting `sessionDate`.

```javascript
// pseudocode
const manilaHour = parseInt(new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', hour: 'numeric', hour12: false
}).format(now));

if (manilaHour < 3) {
  // subtract one day from sessionDate
}
```

**Scope:** Single function, ~5 lines. No API calls, no system prompt changes. The corrected `sessionDate` propagates automatically to `pathFor()`, the save bar path, and the date injected into the system prompt.

**Edge case:** The system prompt tells Claude today's date — that should also reflect the adjusted date so Claude doesn't write the entry header for the wrong day.
