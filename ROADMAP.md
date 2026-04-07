# miles-archive — Roadmap

*Last updated: 2026-04-07*

This file tracks feature status and planned work. Update it when features ship, stall, or get scoped.

---

## Planned

- [ ] **Dynamic section monitoring** — console-log character/token estimates for `patterns.md`, `chat-insights.md`, `people-notes.md`, `people-profile.md` inside `getSysPrompt()`. Surface a warning when any section exceeds ~3000 tokens. Revisit when sessions feel heavy or costs tick up.

---

## Backlog

- [ ] **Clinical summaries** — paths for `summaries/psychiatrist/` and `summaries/rheumatologist/` exist but unused. Could be activated with a dedicated session type or explicit trigger phrase.
- [ ] **Dashboard: people-notes integration** — surface relationship narratives in the Inner Circle section alongside velocity data.
- [ ] **Dashboard: review-log integration** — show last review date and key next steps on dashboard.

---

## Completed

- [x] **Daily journal entry capture** — Claude conversation → `<<<ENTRY_START>>>` markers → save to `journal/daily/YYYY/YYYY-MM-DD.md`
- [x] **Health score tracking** — 10 graymatter metrics + 3 booleans in YAML frontmatter
- [x] **Same-day continuation** — Claude produces merged file; save overwrites existing entry wholesale
- [x] **State of Miles injection** — health context fetched fresh from `notes/state-of-miles.md` at session start
- [x] **Patterns doc** — Claude-maintained `notes/patterns.md` via `<<<PATTERNS_START>>>` markers; user confirms before save
- [x] **Brief mode** — auto-triggered by keywords + manual nav button toggle
- [x] **Draft recovery** — last 3 sessions in localStorage, 18-hour validity
- [x] **Multi-language support** — English, Tagalog, French; Claude follows without comment
- [x] **Deep context fetch** — `<<<FETCH_DEEP>>>` triggers background load of entries 4–10 days ago; injected compressed into next API call
- [x] **Config overlay** — ⚙ button for Anthropic key, GitHub PAT, repo config
- [x] **Fetch overlay** — pull arbitrary repo files into chat context
- [x] **Dashboard** — 14-day graymatter trends, pentagon radars, sparklines, emotional almanac, behavioral correlations, Haiku AI insights *(Mar 1, 2026)*
- [x] **People profile** — `notes/people-profile.md` YAML ledger; Claude-maintained; dashboard Inner Circle section *(Mar 1, 2026)*
- [x] **Evolution entries** — `notes/evolution.md` quarterly life phase summaries; 90-day trigger; dashboard Evolution section *(Mar 1, 2026)*
- [x] **Chat insights** — `notes/chat-insights.md` named observations + open threads; explicit trigger on save phrases *(Mar 26, 2026)*
- [x] **Past-midnight session date** — `_initSessionMeta()` resolves to previous day if Manila hour < 3am *(Apr 5, 2026)*
- [x] **Dashboard tone** — Co-Star voice rules applied to Haiku prompt *(Apr 5, 2026)*
- [x] **People Notes** — `notes/people-notes.md` with markers, save bar (rose accent), context injection *(Apr 5, 2026)*
- [x] **Goals summary maintenance** — `notes/goals-summary.md` write path via markers; conservative daily trigger; always fires in review mode *(Apr 5, 2026)*
- [x] **Review Mode** — separate system prompt; `<<<REVIEW_START>>>` / `<<<REVIEW_END>>>` markers; incomplete entry detection and merge; cascade `review → goals-summary → people → people-notes` *(Apr 5, 2026)*
- [x] **Evolution optimization** — draws from patterns + people-notes + state-of-miles; post-review suggestion when 90+ days since last entry *(Apr 5, 2026)*
- [x] **Auto-update patterns.md** — `triggerPostEntryReview()` fires after every entry/review save; merge-mode output; silent fail; user confirms *(Apr 5, 2026)*
- [x] **System prompt + data file audit** — anchor integrity, section naming fixes, trajectory markers, contradiction trigger, data files repaired *(Apr 5, 2026)*
- [x] **patterns.md restructure + Obsidian wikilinks** — flat `##` sections with bold group labels; merge-unit per section; `[[YYYY-MM-DD]]` date format throughout *(Apr 6, 2026)*
- [x] **Daily reflection tracking** — gratitude/wins/memory per session; Claude infers + confirms; `notes/reflections.md` running log with wikilinks and tags; `buildReflectionTrend()` injects last 3 days into system prompt *(Apr 6, 2026)*
- [x] **Reverse-chronological notes ordering** — all notes files prepend newest entries first; `mergeReflectionsUpdate()` and chat-insights prompts updated to match *(Apr 6, 2026)*
- [x] **Prompt caching + memoization** — `getSysPrompt()` wraps `buildSysPrompt()`; `S._cachedSysPrompt` built once per session; invalidated on state/patterns/goals/insights saves; `sendMsg` max_tokens raised to 4096; `S._deepContext` for ephemeral deep-fetch injection *(Apr 7, 2026)*
- [x] **fetchDeep window narrowed** — 4–14 → 4–10 days *(Apr 7, 2026)*
