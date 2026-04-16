# miles-archive — Claude Code Reference

*Last updated: 2026-04-16*

→ Project overview and self-hosting: [README.md](README.md)
→ Feature status and planned work: [ROADMAP.md](ROADMAP.md)

---

## This Workspace

App repo (`mmraguin/miles-archive`) — GitHub Pages source, four active files:

```
miles-archive/
├── index.html
├── dashboard.html
├── miles-archive.css
└── miles-archive.js
```

Read all four app files before changing any one. `init()` at the bottom of `miles-archive.js` is guarded: only runs if `#app` exists (index.html). Dashboard calls `initDash()` explicitly. Don't remove that guard.

---

## Credentials

No hardcoded keys. Stored in `localStorage`:
`ar_ant` (Anthropic), `ar_gh` (GitHub PAT, repo scope), `ar_repo`, `ar_drafts`

---

## Critical Implementation Details

**API headers — all three required:**
```javascript
'x-api-key': CREDS.anthropicKey,
'anthropic-version': '2023-06-01',
'anthropic-dangerous-direct-browser-access': 'true',  // missing = CORS fail
```

**Max tokens:** `2500` default in `callClaude()` (optional 4th param). Main `sendMsg` passes `4096`. Post-entry review uses `3500`.

**System prompt memoization:** `getSysPrompt()` wraps `buildSysPrompt()` — builds once per session, stored in `S._cachedSysPrompt`. Invalidated when state.md, patterns.md, goals-summary.md, chat-insights.md, or threads.md are saved mid-session. Cleared on session reset.

**Timezone:** All date logic uses `Asia/Manila` via `Intl.DateTimeFormat`. Never use `Date()` offsets.

**Base64:** Use `TextEncoder`/`TextDecoder`, not `escape()`/`unescape()`.

**Session metadata** (`sessionDate`, `sessionDow`, `sessionDay`) computed once at start via `_initSessionMeta()`. Resolves to previous day if Manila hour < 3am. Do not recompute mid-session.

**Entry markers:** Claude wraps completed entries in `<<<ENTRY_START>>>` / `<<<ENTRY_END>>>`. `extractEntry()` depends on these exact strings.

**No native `confirm()`** — uses `inlineConfirm()` with stored callback.

**iOS:** `touch-action: manipulation` on `*`, `visualViewport` resize listener, `env(safe-area-inset-bottom)` on input, click on `#input-inner` delegates to textarea.

---

## System Prompt Architecture

`getSysPrompt()` memoizes `buildSysPrompt()` in `S._cachedSysPrompt`. Sections joined with `\n\n`, filtered for truthiness:

```
identity → context → stateDoc → goalsContext → patternsContext → chatInsightsContext → threadsContext → peopleNotesContext → peopleContext → recentContext → graymatterTrend → reflectionTrend → trendAwareness → sessionOpeners → fetchDeep → coaching → reviewOverdue → briefMode → reflectionElicitation → graymatter → protocol → output → voice → writePreamble → stateUpdate → goalsSummaryUpdate → chatInsightsUpdate → threadsUpdate → peopleNotesUpdate → peopleUpdate → evolutionUpdate → reflectionsUpdate → misc
```

Non-obvious notes:
- `stateDoc` fetched from `notes/state-of-miles.md` at session start — update that file, not the code, to change health context
- `goalsContext` suppressed on hard days / health flares
- `fetchDeep` fires once per session (`deepFetched` guard); result stored in `S._deepContext`, appended to next outgoing message then cleared
- `briefMode` section only present when `S.brief === true`
- `evolutionUpdate` only injected when 90+ days since last entry (or none exists) and 7+ days since last offered
- `threadsUpdate` outputs `<<<THREADS_START>>>` / `<<<THREADS_END>>>` markers; threads.md is auto-saved silently after insights bar confirms — no separate save bar

**File distinctions:**
- `patterns.md` = what the *data* shows — behavioral/health correlations confirmed across journal entries and Garmin data. Answers: *what does the record show?* Sections: HEALTH, BEHAVIORAL, EMOTIONAL only. No GOALS section — goal status tracking belongs in `goals-summary.md`.
- `chat-insights.md` = what *conversations* added — mechanisms explained, reframes that shifted something, distinctions named in a way that landed differently. Answers: *what did the chat surface that the journal alone didn't?* Entry test: if you remove the interface's contribution and the entry still reads like a journal summary, it does not belong here. Entry structure: `**[[YYYY-MM-DD]]** / **What got clearer:** [one plain sentence] / Context: [2–5 lines] / Next move: [only if real handoff needed]`. Newest entries first within each thematic section.
- `threads.md` = operational pointer index, not a knowledge note. No interpretation — source link carries the context. Three sections: Open (has `next_step` + `owner`), Watch (has `next_check`, no action confirmed), Closed (has `resolution`). Entries newest-first within Open. Tagged `[pattern]` or `[insight]`; auto-saved silently after insights bar confirms.

**Operating rule:** Capture once. Summarize once. Reference elsewhere. Do not re-explain the same detail across multiple files. The biggest source of system clutter is over-promotion: one meaningful moment turning into a reflection, an insight, a pattern, a people note, and a thread simultaneously.

**Promotion criteria — write to a file only if the detail qualifies:**
- → `reflections`: one of the day's most worth-remembering moments
- → `chat-insights`: the interface added understanding not already explicit in the journal; entry test must pass
- → `patterns`: repeated enough, or high enough impact, to warrant ongoing attention
- → `state-of-miles`: medically current and data-backed; narrative-only mentions do not qualify
- → `people-profile`: person is recurring enough to deserve a stable entry
- → `goals-summary`: reflects active goal state
- → `evolution`: phase-level shift only; do not generate unless 90+ days since last entry
- → `threads`: unresolved cross-note item; source note holds the meaning, not the thread entry
- → `people-notes`: major relationship with evolving arc; most people should be profile-only

---

## Save Bar Chain

**Daily:** `entry → patterns → goals-summary → insights → people → people-notes → evolution → reflections`
**Review:** `review → goals-summary → people-notes → people-profile`

Each bar queued via `S._queued*`. After entry/review saves, `triggerPostEntryReview()` fires in background — if it produces a patterns update not already in the queue, pat-bar appends after cascade completes.

**threads.md auto-save:** No save bar. When `S._pendingThreads` is set and the insights bar confirms (or is dismissed), `saveThreads()` fires silently. Cache is invalidated after save.

---

## Working Rules

- Read all four app files before changing any of them
- Match existing code style exactly
- Wrap all localStorage in try/catch
- Use `friendlyError()` for all user-facing errors
- Use `addSys()` for system messages
- Do less when in doubt — this is a daily health tool, stability over features
- Debugging: ask for exact error text. GitHub 401 ≠ Anthropic 401.
