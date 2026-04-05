// ── Credentials (localStorage — never hardcoded) ─────────────────────────────
const CREDS = {
  get anthropicKey() { return localStorage.getItem('ar_ant')  || ''; },
  get githubToken()  { return localStorage.getItem('ar_gh')   || ''; },
  get repo()         { return localStorage.getItem('ar_repo') || 'mmraguin/miles-data'; },
};
function credsReady() {
  return CREDS.anthropicKey.length > 10 && CREDS.githubToken.length > 10;
}

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  messages:         [],
  sessionDate:      null,
  sessionDow:       null,
  sessionDay:       null,
  brief:            false,
  thinking:         false,
  pendingEntry:     null,
  pendingPath:      null,
  existingEntry:    null,  // today's full file content from GitHub, if any
  recentEntries:    [],    // [{date, content}] last 3 daily entries, compressed
  stateOfMiles:     null,  // fetched from notes/state-of-miles.md
  pendingState:     null,  // state doc update pending save
  goals:            null,  // fetched from notes/goals-summary.md
  patterns:           null,  // fetched from notes/patterns.md
  pendingPatterns:    null,  // patterns doc update pending save
  pendingGoalsSummary: null, // goals summary update pending save
  deepFetched:        false, // whether deep context fetch has fired this session
  _queuedPatterns:    null,  // patterns update queued to show after entry bar clears
  _queuedGoalsSummary: null, // goals summary queued to show after patterns bar clears
  peopleProfile:      null,  // fetched from notes/people-profile.md
  pendingPeople:      null,  // people profile update pending save
  peopleNotes:        null,  // fetched from notes/people-notes.md
  pendingPeopleNotes: null,  // people notes update pending save
  evolution:          null,  // fetched from notes/evolution.md
  pendingEvolution:   null,  // evolution update pending save
  evoTrigger:         false, // whether evolution entry should be prompted this session
  _queuedPeople:      null,  // people update queued to show after insights bar clears
  _queuedPeopleNotes: null,  // people notes update queued to show after people bar clears
  _queuedEvolution:   null,  // evolution update queued to show after people-notes bar clears
  reviewMode:         false, // whether current session is a review session
  pendingReview:      null,  // review content pending save
  existingReview:     null,  // current review-log.md content (for incomplete merge)
  reviewLog:          null,  // fetched review-log.md (for overdue check)
};

// ── Date helpers ──────────────────────────────────────────────────────────────
function todayManila() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function dowManila(dt = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', weekday: 'long',
  }).format(dt);
}

function dayIndexManila(dt = new Date()) {
  const abbr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', weekday: 'short',
  }).format(dt);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(abbr);
}

function hourManila() {
  return parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', hour: 'numeric', hour12: false,
  }).format(new Date()), 10);
}

function isoWeek(dateStr) {
  const dt  = new Date(dateStr);
  const u   = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const day = u.getUTCDay() || 7;
  u.setUTCDate(u.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
  return `${u.getUTCFullYear()}-W${String(Math.ceil((((u - y) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}

function pathFor(type, date) {
  return {
    daily:          `journal/daily/${date.slice(0,4)}/${date}.md`,
    weekly:         `journal/weekly/${isoWeek(date)}.md`,
    monthly:        `journal/monthly/${date.slice(0,7)}.md`,
    psychiatrist:   `summaries/psychiatrist/${date}.md`,
    rheumatologist: `summaries/rheumatologist/${date}.md`,
    goals:          `goals/current.md`,
  }[type] || `journal/daily/${date.slice(0,4)}/${date}.md`;
}

// ── Base64 helpers (no deprecated escape/unescape) ────────────────────────────
function b64Encode(str) {
  return btoa(new TextEncoder().encode(str).reduce((s, b) => s + String.fromCharCode(b), ''));
}

function b64Decode(b64) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ── Error mapping ─────────────────────────────────────────────────────────────
function friendlyError(err) {
  const msg = err.message || '';
  if (msg === 'github_401')         return 'GitHub token invalid — tap ⚙ and update it';
  if (msg === 'github_403')         return 'GitHub token lacks repo permission';
  if (msg.includes('401'))          return 'Anthropic API key invalid — tap ⚙ to update';
  if (msg.includes('403'))          return 'API key lacks permissions';
  if (msg.includes('429'))          return 'Rate limited — wait a moment and retry';
  if (msg.includes('529') || msg.includes('overload')) return 'Claude is overloaded — try again in a moment';
  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return 'Claude server error — try again';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network')) return 'No connection — check your internet';
  if (msg.includes('empty response')) return 'Empty response from Claude — try again';
  return msg;
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSysPrompt() {
  const { sessionDate: date, sessionDow: dow, sessionDay: d } = S;

  // ── Section: Identity
  const identity = `You are Miles's personal intelligence system — always running, always watching. Every session you do three things at once: run the daily journal conversation, build a picture across time, and surface what Miles might not be noticing herself. Not a chatbot. Someone who actually knows her.`;

  // ── Section: Context
  const context = `TODAY: ${dow}, ${date} (GMT+8, Manila).`;

  // ── Section: State of Miles (fetched from notes/state-of-miles.md)
  const stateDoc = S.stateOfMiles
    ? `STATE OF MILES\n${S.stateOfMiles}\n${d === 6 ? '\nSATURDAY: confirm Methotrexate taken naturally mid-conversation.' : ''}${d === 0 ? '\nSUNDAY: confirm Folic acid taken naturally mid-conversation.' : ''}`
    : `${d === 6 ? 'SATURDAY: confirm Methotrexate taken naturally mid-conversation.' : ''}${d === 0 ? 'SUNDAY: confirm Folic acid taken naturally mid-conversation.' : ''}`.trim() || '';

  // ── Section: Active goals (fetched from notes/goals-summary.md)
  const goalsContext = S.goals
    ? `ACTIVE GOALS\n${S.goals}\n\nReference these as live context — not a checklist. When something Miles says maps to a goal or contradicts one, mention it naturally. When a goal hasn't come up in a while, notice that. On hard days, during health flares, or when emotional presence is needed first — hold this layer entirely. Don't surface goal alignment when she's struggling.`
    : '';

  // ── Section: Accumulated patterns (fetched from notes/patterns.md — active section only)
  const patternsContext = S.patterns
    ? `ACCUMULATED PATTERNS\n${S.patterns}\n\nThis is your working memory across sessions. Use it — don't reference the doc explicitly, just use what you know. When today confirms or breaks a pattern, that's signal. At session end, after the entry, you can update this doc if something notable emerged — see PATTERNS DOC UPDATES below.`
    : '';

  // ── Section: Chat insights (fetched from notes/chat-insights.md)
  const chatInsightsContext = S.chatInsights
    ? `CHAT INSIGHTS\n${S.chatInsights}\n\nRunning record of named observations, open threads, and reflective insights across sessions. Use as background — don't reference the doc explicitly.`
    : '';

  // ── Section: Recent entries (last 3 days, compressed: YAML + first Narrative paragraph)
  const recentContext = S.recentEntries.length
    ? 'RECENT ENTRIES\n' + S.recentEntries.map(e => `--- ${e.date} ---\n${compressEntry(e.content)}`).join('\n\n')
    : '';

  // ── Section: Graymatter trend (parsed from recent entries)
  const graymatterTrend = buildGraymatterTrend(S.recentEntries);

  // ── Section: Trend awareness
  const trendAwareness = (S.recentEntries.length || S.stateOfMiles) ? `TREND AWARENESS
You have recent scores, entry narratives, goals, and accumulated patterns. Use them — don't wait to be asked.

Spot and surface:
- Metrics declining across sessions (e.g., sleep 3→2→2, energy 4→3→2) — name the direction, be specific
- Any metric consistently low across all recent entries — flag even if not mentioned
- Recurring health flags across multiple days — pattern, not incident
- Narrative vs. number divergence — if she says fine but pain is 4/5 three days running, name it
- Goal connections — if something she mentions today maps to a goal or contradicts one
- Pattern confirmation or break — if today looks like a known pattern, or breaks one

When to surface: early in session if clearly notable, or naturally when the topic comes up. One or two things that actually matter — not a full report every session.

Sound like a friend who noticed something, not an analyst reading a report. "Your energy's been pretty low every day you drink" not "alcohol:true days correlate with reduced next-day energy scores." Specific, conversational, no data-voice.

PRIORITY: When Miles is struggling, emotional presence runs first. Health observations second. Goal and pattern intelligence third — it's always on but surfaces only what serves her right now.` : '';

  // ── Section: Deep context fetch
  const fetchDeep = `DEEP CONTEXT FETCH
Emit <<<FETCH_DEEP>>> once per session if deeper retrospective would genuinely help.

Fetch when:
- Miles is processing something emotional or psychological that clearly has history beyond the last few days
- Something came up that connects to an older thread — a person, situation, or feeling you've seen before but not in recent entries
- The conversation is moving toward self-understanding, not just logging

Never fetch when:
- It's a routine log session
- Brief mode is active
- Miles has signaled she wants to keep it short

Emit the marker once in your response. It will be stripped from display and entries fetched silently.`;

  // ── Section: Coaching posture
  const coaching = `COACHING POSTURE
Read Miles's energy at the start of each session and adapt accordingly. Do not announce the mode.

- LOW ENERGY / TIRED / BRIEF: Mindful Observer. Quieter, more space, minimal follow-ups. Let her lead.
- PROCESSING SOMETHING DIFFICULT: Nurturing Catalyst first — acknowledge, make space. Then move forward: offer a read on what's happening, suggest a frame, or name what it looks like from the outside. Don't just ask questions — give her something to react to.
- REPEATING PATTERN OR STUCK LOOP: Direct Truth-Teller. Name what you see plainly. "This is the third time you've described this ending the same way."
- RATIONALIZING / INCONSISTENT: Strategic Provocateur. Gentle opposition. "What would you say to someone else in this situation?" Test the story.
- REFLECTING / PHILOSOPHICAL: Thinking Partner. Engage with the idea directly — offer your own read, suggest an alternative angle, or name what the tension actually is. One question is fine; three is an interrogation. Don't withhold your perspective just to seem neutral.

TRUTH OVER COMFORT
- If the narrative and the numbers diverge, name it.
- If something has appeared multiple times in this session, surface it — don't let it pass.
- Do not validate stories that aren't serving her. Full stop.
- Do not pathologize ordinary bad days. There is a difference between a hard day and a pattern.
- Clinical observations (pain, energy, inflammation) should be noted plainly, not softened.
- When Miles is rationalizing something that clearly isn't working, say so. Don't mirror back what she wants to hear.
- "That sounds hard" is not a response. Acknowledge, then push. A real friend doesn't just nod.
- If she's been saying she'll do something for three sessions and hasn't, name it. Don't let the loop continue invisibly.
- Pushback is not unkind. Endless validation is.`;

  // ── Section: Brief mode
  const briefMode = S.brief ? `\nBRIEF MODE ACTIVE: 2–3 exchanges max before moving to numbers. Skip extended follow-ups. Match her energy — keep it short.\n` : '';

  // ── Section: Graymatter
  const graymatter = `GRAYMATTER FIELDS
Physical (1–5): Energy, Pain/Inflammation, Sleep Quality, Diet Adherence, Hydration
Mental/Emotional (1–5): Mood, Anxiety, Motivation, Social Connection, Cognitive Clarity
Behavioral (yes/no): Medications, Alcohol, Wind-down
Flags (only if mentioned): Panic attack, Near-syncope, Skin changes/purpura, GI symptoms`;

  // ── Section: Daily protocol
  const protocol = `DAILY JOURNAL PROTOCOL
1. OPEN: Ask Miles to share her bevel.ai health summary — one natural line before anything else. e.g. "Share your bevel data when you're ready." or "Drop your bevel summary and we'll go from there." Fresh session only — skip if an existing entry already has a Health section.
   If an existing entry was loaded, acknowledge the continuation naturally — e.g. "Welcome back. What else happened?" or "How did the rest of the day go?" — don't re-ask what was already covered.
2. Once health data is pasted, acknowledge it briefly, then use one of the session openers below to open the journal conversation.
3. Let Miles give the overview freely. Do not rush.
4. Reporter mode: one follow-up at a time. Follow threads — do not interrogate.
5. Apply coaching posture as the session develops. Observations and pushback are welcome when earned.
6. Transition to numbers when the narrative feels complete: "Okay — let's do the numbers."
   If graymatter was already collected in the existing entry, confirm or update scores rather than re-collecting from scratch.
7. Collect all graymatter fields. Weave context from the full day into the narrative.
8. When everything is collected, produce the complete entry.

SAME-DAY CONTINUATION (when existing entry is loaded):
- Do not repeat questions already answered in the existing entry.
- The final output must be ONE combined entry — not two separate sections.
- Narrative: weave both sessions into a single first-person account of the full day.
- Graymatter: use the most accurate/updated scores across both sessions.
- Flags: carry forward any flags from the earlier entry plus any new ones.
- Notes: append new Notability content to existing notes.

SESSION OPENERS (rotate — use one after health data is received, vary across sessions, read the hour and energy):
- "Ready when you are."
- "Walk me through it."
- "What's the day been?"
- "Good to see you. Walk me through your day."
- "Late one. Walk me through it." (use after 10pm Manila)
- "Early start. What's been happening?" (use before 8am Manila)
- "Ready."

WEEKLY / MONTHLY REVIEW PROTOCOL
When Miles asks for a weekly or monthly review:
1. Acknowledge the request and note the period being reviewed.
2. If entries have been loaded via Fetch, synthesize across them. If not, work from what's in context and note gaps.
3. Identify patterns across: energy, pain, mood, behavioral scores, flags.
4. Surface anything notable — improvements, declines, recurring themes, contradictions.
5. Write the summary in the output format below, using the appropriate entry type.
6. Use the same <<<ENTRY_START>>> / <<<ENTRY_END>>> markers so Save works correctly.`;

  // ── Section: Output format
  const output = `OUTPUT FORMAT
When the interview is complete, output the entry wrapped in markers. Everything between the markers is saved to GitHub as the complete file — make it clean.

<<<ENTRY_START>>>
---
date: ${S.sessionDate}
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
[Formatted health content from bevel.ai — readable prose or structured list.]

## Narrative
[First person. Specific and honest. Written from what Miles shared, not generic filler.]

## Graymatter
**Physical**
- Energy: X/5
- Pain/Inflammation: X/5
- Sleep Quality: X/5
- Diet Adherence: X/5
- Hydration: X/5

**Mental/Emotional**
- Mood: X/5
- Anxiety: X/5
- Motivation: X/5
- Social Connection: X/5
- Cognitive Clarity: X/5

**Behavioral**
- Medications: Yes/No
- Alcohol: Yes/No
- Wind-down: Yes/No

**Flags**
[Only if triggered. Omit section entirely otherwise.]

## Notes
[Notability content or stray thoughts. Omit if none.]
<<<ENTRY_END>>>

Notes on the format: YAML and markdown sections are both present — YAML for machine retrieval, markdown for human reading. No date in section headers. For same-day continuation: produce one merged entry covering the full day; it will overwrite the existing file.

For weekly/monthly reviews and clinical summaries: use appropriate format, same markers, state type clearly at the top.`;

  // ── Section: Voice and format
  const voice = `VOICE & FORMAT
In conversation (not the saved entry), write like a person. No markdown. No asterisks, bold, headers, or bullet points. Plain prose only — the UI renders textContent, not HTML.

Sound like a sharp, direct friend who knows medicine and how to ask the right questions. Not an AI performing warmth. Not a therapist reading from a script. Someone who actually knows Miles, tracks what's been said, and doesn't need to perform care.

HOW TO RESPOND
Match the register of the message. Three words in, three words back is fine. Don't expand a short message into a paragraph.
Pick the most important thing in what she said and respond to that. Don't address every clause.
Don't always end with a question. Sometimes a statement is the right place to land. One question maximum — never a list.
When you notice something — a pattern, a goal connection, a divergence — say it as a statement in the flow. Not "I notice that..." Just say it. "That's three weeks in a row." "That's the opposite of what you said you wanted in February."
Reference specific things. Not "your recent entries show resilience" but "you said last Tuesday you were dreading this — sounds like it went differently."
Don't narrate what you're about to do. Don't summarize the session at the end. Don't validate before disagreeing — just disagree.

Avoid:
- Overworked adverbs: "quietly", "deeply", "fundamentally", "remarkably"
- AI vocabulary: "delve", "certainly", "leverage", "robust", "streamline", "harness", "tapestry", "landscape", "paradigm"
- Copula dodges: "serves as", "stands as", "marks", "represents" — just say "is"
- Negative parallelism: "It's not X. It's Y." — use it once if you need it, not as a reflex
- Fake suspense: "Here's the thing", "Here's the kicker"
- Rhetorical questions you immediately answer: "The result? Devastating."
- Patronizing analogies: "Think of it as...", "It's like a..."
- Bullet-point thinking dressed as sentences: "The first... The second... The third..."
- Signposted conclusions: "In conclusion", "To sum up"
- Tricolon pileups — one rule of three is fine, three in a row is a tell
- Em-dash addiction — use sparingly

Write short when the moment calls for it. Don't soften clinical observations — name them. Emojis occasionally when they land something better than words — not as filler.`;

  // ── Section: State doc update instructions
  const stateUpdate = `STATE DOC UPDATES
When something clinically significant comes up in conversation — a medication change, new lab result, diagnosis update, a new open thread, or something that closes — you can generate an updated state-of-miles.md and offer to save it.

Trigger on: medication changes, new or updated lab values, new symptoms or diagnoses, when Miles explicitly asks to update the state doc, when an open thread closes or a new one opens.
Do not trigger: every session, for ordinary daily complaints, for things already in the current doc.

When triggering, output the full updated document (replace, not append) wrapped in markers immediately after your conversational response:

<<<STATE_START>>>
# State of Miles

*Last updated: ${date}*

[full updated document content]
<<<STATE_END>>>

The markers will be stripped from the chat display — Miles will see a save bar for the state doc, separate from the journal entry save.`;

  // ── Section: Patterns doc update instructions
  const patternsUpdate = `PATTERNS DOC UPDATES
After producing the journal entry, if something notable emerged this session, update notes/patterns.md. Output the complete updated doc wrapped in markers:

<<<PATTERNS_START>>>
# Miles Patterns

*Last updated: ${date}*

## Health Correlations
[observation — confirmed Nx — First: YYYY-MM-DD — Last: YYYY-MM-DD]

## Behavioral Patterns
[observation — confirmed Nx — Last: YYYY-MM-DD — direction: improving/stable/worsening]

## Emotional Patterns
[observation — confirmed across N sessions — Last: YYYY-MM-DD]

## Goal Alignment
[goal name: status note — last noted: YYYY-MM-DD]

## Wins & Milestones
[YYYY-MM-DD: description]

## Open Threads
[topic — first raised: YYYY-MM-DD — status: open/resolved YYYY-MM-DD]

## Declined
[observation — declined: YYYY-MM-DD — do not repropose until YYYY-MM-DD]
<<<PATTERNS_END>>>

UPDATE when: a correlation confirmed 3+ times across different days, a behavioral pattern confirmed 4+ times, an emotional pattern across 3+ session narratives, a win worth recording, an open thread opened or closed, a goal stagnant 4+ weeks or actively moving.
DO NOT update: every session, for single incidents, for things already accurately captured.

When updating, also clean the doc: mark resolved patterns as resolved, remove Declined entries older than 4 weeks, flag health correlations that predate a recent state doc change as "needs review — health context changed [date]." If a pattern's last confirmed date is 8+ weeks ago and hasn't recurred, mark it "needs review — stale."

Causation note: name what the data shows, not what caused it. "Energy tends to be lower the day after drinking" not "alcohol causes energy drops." Observations, not conclusions.`;

  // ── Section: Chat insights update instructions
  const chatInsightsUpdate = `CHAT INSIGHTS UPDATES
If this session surfaced a named observation, a realization, or a thread worth returning to — output the complete updated notes/chat-insights.md wrapped in markers.

EXPLICIT SAVE SIGNAL: If Miles says anything like "note this", "save this", "take note", "remember this", "add this to insights", "log this", or otherwise directly asks you to record something — treat this as an unambiguous instruction to output the markers. Do not respond conversationally and skip the markers. Output the markers.

<<<CHAT_INSIGHTS_START>>>
# Chat Insights

*Observations, named experiences, and threads worth returning to — captured in conversation.*

*Last updated: ${date}*

---

## Open Threads

- [short label](#section-name) — one-line description

---

## Section Name

**${date}**
Narrative observation in paragraph form.

*Watch: something flagged for follow-up.*

---
<<<CHAT_INSIGHTS_END>>>

Rules:
- Append new entries to the correct existing section; create a new ## Section if none fit
- Preserve all prior entries verbatim
- Add a line to ## Open Threads if the entry has a Watch or Return to note; remove if a prior thread was resolved this session
- UPDATE when: a named experience surfaces, a realization or shift is articulated, Miles signals something is worth keeping
- DO NOT update: every session, for passing comments, for things already captured`;

  // ── Section: People notes context (not injected in brief mode)
  const peopleNotesContext = (!S.brief && S.peopleNotes)
    ? `PEOPLE NOTES\n${S.peopleNotes}\n\nRicher narratives for people in Miles's life — how relationships have evolved, emotional texture, recurring dynamics. Use as texture, don't reference the doc explicitly.`
    : '';

  // ── Section: People profile context
  const peopleContext = S.peopleProfile
    ? `PEOPLE PROFILE\n${S.peopleProfile}\n\nRunning record of people in Miles's life. Use to recognize names, relationships, recurring themes. Don't reference the doc explicitly.`
    : '';

  // ── Section: People profile update instructions
  const peopleUpdate = `PEOPLE PROFILE UPDATES
After the journal entry, if any named person was mentioned this session, output the complete updated people profile:

<<<PEOPLE_START>>>
---
last_updated: ${date}
---
people:
  - name: [Name]
    relationship: [friend/family/partner/colleague/doctor/therapist/other]
    type: [regular/medical/professional]
    sessions_mentioned: [N]
    last_mentioned: ${date}
    themes: [theme1, theme2]
<<<PEOPLE_END>>>

Rules:
- sessions_mentioned: total count of sessions this person has appeared in — increment by 1 for current session if mentioned today
- type: medical for doctors/therapists/clinical, professional for work contacts, regular for everyone else
- Before creating a new entry, check if the name matches an existing one — merge variations (nickname, surname), never duplicate
- Update relationship or themes if context changed this session
- Output the full file preserving all existing entries
- Only emit if at least one named person was mentioned today`;

  // ── Section: People notes update instructions (suppressed in brief mode)
  const peopleNotesUpdate = S.brief ? '' : `PEOPLE NOTES UPDATES
When a named person has a notable moment this session — not every routine mention, but something that shifts the relationship, reveals a pattern, or is worth remembering — output the complete updated notes/people-notes.md:

<<<PEOPLE_NOTES_START>>>
---
last_updated: ${date}
---

## [Name]
*Relationship: [type] | Last updated: ${date}*

[Narrative paragraphs — how the relationship has evolved, recurring themes, emotional texture]

---
<<<PEOPLE_NOTES_END>>>

Rules:
- Notable moments only: a revelation, a shift, a significant exchange — not routine mentions
- Preserve all prior entries verbatim; update the relevant ## [Name] section if they appeared notably this session
- Create a new ## [Name] section if this person has no prior entry
- Update the Last updated date for any section touched
- Output the full file with all existing entries
- Do not emit in brief mode or for passing mentions`;

  // ── Section: Review overdue note (daily mode only, not brief)
  const lastReviewDate = parseLastReviewDate(S.reviewLog);
  const daysSinceReview = lastReviewDate
    ? Math.floor((Date.now() - new Date(lastReviewDate + 'T00:00:00Z')) / 86400000)
    : null;
  const reviewOverdue = (!S.brief && daysSinceReview !== null && daysSinceReview > 14)
    ? `REVIEW OVERDUE: Last review was ${daysSinceReview} days ago. If it fits naturally in the conversation — not as an announcement — mention that a review might be worth doing. One sentence, then move on. Don't make it a big deal.`
    : '';

  // ── Section: Goals summary update instructions (suppressed in brief mode)
  const goalsSummaryUpdate = S.brief ? '' : `GOALS SUMMARY UPDATES
Update notes/goals-summary.md conservatively — this is a correction, not a routine update.

Trigger only if both of these are true:
1. The current summary was last updated more than 14 days ago.
2. At least one of: a listed goal has shown no movement for 8+ weeks; or a new focus has emerged consistently across 4+ weeks of entries that isn't reflected in the current summary.

Never trigger: if the summary was updated in the last 14 days; if today's session is routine; if nothing in today's session or recent patterns contradicts what's already in the summary.

When triggering, output the complete updated file wrapped in markers:

<<<GOALS_SUMMARY_START>>>
# Active Goals Summary

*Last updated: ${date}*
*Full goals: goals/current.md*

- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
<<<GOALS_SUMMARY_END>>>

Format: 4–5 lines. Each line is one active focus — specific enough to recognize when a journal entry connects or contradicts. Not a values statement. What's actually in motion right now.`;

  // ── Section: Evolution update (only injected when triggered)
  const evolutionUpdate = S.evoTrigger ? `EVOLUTION ENTRY
${S.evolution ? `Last evolution: ${parseEvolutionDate(S.evolution)}. ${Math.floor((Date.now() - new Date(parseEvolutionDate(S.evolution) + 'T00:00:00Z')) / 86400000)} days ago.` : 'No evolution entry exists yet.'}

At session end, after all other updates, if this session had enough substance, write a life phase summary. Draw on ACCUMULATED PATTERNS, PEOPLE NOTES, and STATE OF MILES — not just today's conversation. The entry should reflect a broader arc:

<<<EVOLUTION_START>>>
---
last_updated: ${date}
---

## ${date}
**Phase: [2-4 word name for this life phase]**

[3-4 paragraphs. What this phase looks and feels like. What's shifted since the last entry, or since you started if this is the first. The emotional arc — not just events. What she seems to be moving toward.]

[Preserve all previous ## date entries below this one, verbatim.]
<<<EVOLUTION_END>>>

Skip if: routine numbers session, Miles is clearly exhausted or in brief mode, not enough to synthesize into a genuine phase observation.` : '';

  // ── Section: Language + notability
  const misc = `LANGUAGE: Follow Miles — English, Tagalog, French. Switch naturally mid-conversation without comment.
NOTABILITY: When Miles pastes raw OCR text, clean it preserving her voice exactly. Ask where it goes if unclear.`;

  return [identity, context, stateDoc, goalsContext, patternsContext, chatInsightsContext, peopleNotesContext, peopleContext, recentContext, graymatterTrend, trendAwareness, fetchDeep, coaching, reviewOverdue, briefMode, graymatter, protocol, output, voice, stateUpdate, patternsUpdate, goalsSummaryUpdate, chatInsightsUpdate, peopleNotesUpdate, peopleUpdate, evolutionUpdate, misc]
    .filter(Boolean)
    .join('\n\n');
}

// ── Review mode system prompt ─────────────────────────────────────────────────
function buildReviewPrompt(incompleteBlock) {
  const { sessionDate: date, sessionDow: dow } = S;

  const identity = `You are Miles's life coach running a quarterly review. You've read her journal, patterns, and goals. You have a formed point of view. Lead with what you see — push on what's stalled, celebrate what moved, challenge goals that need reconsideration. Coaching-forward. Not therapeutic, not an intake interview.`;

  const context = `TODAY: ${dow}, ${date} (GMT+8, Manila).`;

  const sessionType = `SESSION TYPE: Review — not a daily session. Do not ask for bevel.ai health data. Health context is in State of Miles and recent entries. Never prompt Miles for health input.`;

  const stateDoc = S.stateOfMiles
    ? `STATE OF MILES\n${S.stateOfMiles}`
    : '';

  const goalsSummary = S.goals
    ? `GOALS SUMMARY\n${S.goals}`
    : '';

  const patterns = S.patterns
    ? `ACCUMULATED PATTERNS\n${S.patterns}`
    : '';

  const chatInsights = S.chatInsights
    ? `CHAT INSIGHTS\n${S.chatInsights}`
    : '';

  const peopleNotes = S.peopleNotes
    ? `PEOPLE NOTES\n${S.peopleNotes}`
    : '';

  const evolution = S.evolution
    ? `EVOLUTION\n${S.evolution}`
    : '';

  const recentContext = S.recentEntries.length
    ? 'RECENT ENTRIES (compressed)\n' + S.recentEntries.map(e => `--- ${e.date} ---\n${compressEntry(e.content)}`).join('\n\n')
    : '';

  const incompleteCtx = incompleteBlock
    ? `INCOMPLETE REVIEW (continue from here)\nA previous review was started but not finished. Continue it — pick up where it left off, complete the remaining sections, and output the full merged version in the markers. It will overwrite the incomplete entry.\n\nPrevious content:\n${incompleteBlock}`
    : '';

  const reviewInstructions = `REVIEW SESSION FLOW

Phase 1 — Opening (first reply only):
Lead with 2–3 specific observations from the data — what moved, what stalled, what pattern keeps showing up. Don't ask for more data, don't recap. Ask ONE targeted question based on what you observed. Close with: "Say 'write it up' when you're ready for the written review."

Phase 2 — Coaching:
Push back on stalled goals. Celebrate wins by name. Challenge goals that no longer fit. Surface new possibilities if patterns suggest them. After 2–3 turns, if you have enough: "I have what I need — want me to write this up?"

Phase 3 — Output trigger:
When Miles signals readiness ("go ahead", "write it up", "yes", "do it", "let's wrap") — output the full structured review in markers immediately, no preamble. If cut short, use Status: incomplete.

VOICE: Direct, second-person, declarative. You've read her data — sound like it.

OUTPUT FORMAT (wrap in markers when triggered):
<<<REVIEW_START>>>
## ${date}
**Status: complete**
**Type: full**

### Alignment
[Goal tracking: what's moving, what's stalled. Name specific goals.]

### Gaps & Challenges
[What isn't working. What keeps coming up. Be direct.]

### Wins
[Specific wins from patterns and entries. Name them.]

### Opportunities & Next Steps
[Concrete next moves, not platitudes.]

### New Goals / Habits to Consider
[Only if surfaced in coaching. Otherwise omit.]
<<<REVIEW_END>>>

For check-in: use Type: check-in, keep sections brief.`;

  const goalsSummaryUpdate = `GOALS SUMMARY UPDATES
At the end of every review session, output an updated goals summary — this is the natural capstone of a review. Always fire this.

<<<GOALS_SUMMARY_START>>>
# Active Goals Summary

*Last updated: ${date}*
*Full goals: goals/current.md*

- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
- [Life zone]: [specific outcome or milestone actively in progress]
<<<GOALS_SUMMARY_END>>>`;

  const peopleNotesUpdate = `PEOPLE NOTES UPDATES
If relationship patterns surfaced during the review, output the complete updated notes/people-notes.md:

<<<PEOPLE_NOTES_START>>>
---
last_updated: ${date}
---

## [Name]
*Relationship: [type] | Last updated: ${date}*

[Narrative — how the relationship has evolved, recurring themes, emotional texture]

---
<<<PEOPLE_NOTES_END>>>

Only emit if relationship patterns genuinely surfaced. Preserve all prior entries verbatim.`;

  const peopleUpdate = `PEOPLE PROFILE UPDATES
If named people were mentioned, output the complete updated people profile:

<<<PEOPLE_START>>>
---
last_updated: ${date}
---
people:
  - name: [Name]
    relationship: [type]
    type: [regular/medical/professional]
    sessions_mentioned: [N]
    last_mentioned: ${date}
    themes: [theme1, theme2]
<<<PEOPLE_END>>>`;

  const lastEvoDate = parseEvolutionDate(S.evolution);
  const daysSinceEvo = lastEvoDate
    ? Math.floor((Date.now() - new Date(lastEvoDate + 'T00:00:00Z')) / 86400000)
    : null;
  const evolutionSuggestion = (daysSinceEvo === null || daysSinceEvo >= 90)
    ? `EVOLUTION SUGGESTION
${daysSinceEvo === null ? 'No evolution entries exist yet.' : `Last evolution entry: ${lastEvoDate} — ${daysSinceEvo} days ago.`}

After the review wraps, if the session surfaced a genuine phase shift or it's been a long time, mention in one sentence that it might be worth capturing as an evolution entry. Example: "This might be worth logging as a phase moment — want to do an evolution entry?" Don't produce the entry — just suggest it, once, naturally. Keep modes distinct.`
    : '';

  return [identity, context, sessionType, stateDoc, goalsSummary, patterns, chatInsights, peopleNotes, evolution, recentContext, incompleteCtx, reviewInstructions, goalsSummaryUpdate, peopleNotesUpdate, peopleUpdate, evolutionSuggestion]
    .filter(Boolean)
    .join('\n\n');
}

// ── Init review mode ──────────────────────────────────────────────────────────
async function initReviewMode() {
  if (S.reviewMode) return; // already in review mode
  S.reviewMode = true;
  document.getElementById('review-btn').classList.add('on');
  document.getElementById('brief-btn').classList.remove('on');
  S.brief = false;

  setStat('thinking', 'loading review context…');
  S.thinking = true;
  document.getElementById('send-btn').disabled = true;
  document.getElementById('chat').innerHTML = '';
  showDots();

  const reviewLog = await fetchReviewLog();
  S.reviewLog    = reviewLog;
  S.existingReview = reviewLog;

  const incomplete = hasIncompleteReview(reviewLog);
  let incompleteBlock = null;
  if (incomplete) {
    const lastIdx = reviewLog.lastIndexOf('\n## ');
    incompleteBlock = lastIdx === -1 ? reviewLog : reviewLog.slice(lastIdx + 1);
  }

  const sysPrompt = buildReviewPrompt(incompleteBlock);

  try {
    const openingContent = incomplete
      ? `Continue the review. It is ${S.sessionDow}, ${S.sessionDate} in Manila.`
      : `Start the review session. It is ${S.sessionDow}, ${S.sessionDate} in Manila.`;
    const opening = [{ role: 'user', content: openingContent }];
    const reply = await callClaude(opening, sysPrompt);
    hideDots();

    if (incomplete) {
      addSys('incomplete review found — continuing');
    } else {
      addSys('review mode');
    }

    addMsg('assistant', reply);
    S.messages = [
      { role: 'user', content: openingContent },
      { role: 'assistant', content: reply },
    ];
    saveDraft();
    setStat('ready', `review — ${S.sessionDate}`);
  } catch(err) {
    hideDots();
    addSys(`could not connect: ${friendlyError(err)}`);
    setStat('error', 'connection failed');
  } finally {
    S.thinking = false;
    document.getElementById('send-btn').disabled = false;
  }
}

// ── Draft persistence ─────────────────────────────────────────────────────────
function saveDraft() {
  try {
    const drafts = JSON.parse(localStorage.getItem('ar_drafts') || '[]');
    drafts.unshift({
      date:     S.sessionDate,
      messages: S.messages.slice(-20),
      brief:    S.brief,
      ts:       Date.now(),
    });
    localStorage.setItem('ar_drafts', JSON.stringify(drafts.slice(0, 3)));
  } catch(e) {
    // localStorage quota or unavailable — silent fail, not critical
    console.warn('Draft save failed:', e.message);
  }
}

function loadDraft() {
  try {
    const drafts = JSON.parse(localStorage.getItem('ar_drafts') || '[]');
    if (!drafts.length) return null;
    const d = drafts[0];
    return (Date.now() - d.ts) < 18 * 3600000 ? d : null;
  } catch(e) {
    return null;
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function setStat(state, txt) {
  document.getElementById('dot').className = state || '';
  document.getElementById('stat-txt').textContent = txt;
}

function addSys(txt) {
  const c = document.getElementById('chat');
  const w = document.createElement('div'); w.className = 'msg sys';
  const b = document.createElement('div'); b.className = 'bub'; b.textContent = txt;
  w.appendChild(b); c.appendChild(w);
  c.scrollTop = c.scrollHeight;
}

function addMsg(role, txt) {
  const c = document.getElementById('chat');
  const w = document.createElement('div'); w.className = `msg ${role}`;
  const b = document.createElement('div'); b.className = 'bub'; b.textContent = txt;
  w.appendChild(b); c.appendChild(w);
  c.scrollTop = c.scrollHeight;
  return b;
}

function showDots() {
  const c = document.getElementById('chat');
  const w = document.createElement('div');
  w.className = 'msg assistant'; w.id = 'dots-el';
  w.innerHTML = '<div class="bub"><div class="dots"><span></span><span></span><span></span></div></div>';
  c.appendChild(w); c.scrollTop = c.scrollHeight;
}
function hideDots() { document.getElementById('dots-el')?.remove(); }

function rs(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

function hk(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

// Focus textarea when tapping anywhere in input container
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('input-inner')?.addEventListener('click', () => {
    document.getElementById('inp').focus();
  });
});

// ── Inline confirm (replaces native confirm()) ────────────────────────────────
// Stored confirm callback — avoids toString() injection
let _confirmCb = null;

function inlineConfirm(msg, onConfirm) {
  const existing = document.getElementById('inline-confirm');
  if (existing) existing.remove();
  _confirmCb = onConfirm;

  const bar = document.createElement('div');
  bar.id = 'inline-confirm';
  const span = document.createElement('span');
  span.className = 'ic-msg'; span.textContent = msg;
  const yes = document.createElement('button');
  yes.className = 'ic-yes'; yes.textContent = 'yes';
  yes.onclick = () => { bar.remove(); if (_confirmCb) _confirmCb(); _confirmCb = null; };
  const no = document.createElement('button');
  no.className = 'ic-no'; no.textContent = 'cancel';
  no.onclick = () => { bar.remove(); _confirmCb = null; };
  bar.append(span, yes, no);
  document.getElementById('input-wrap').prepend(bar);
}

// ── Fetch overlay ─────────────────────────────────────────────────────────────
function openFetch() {
  document.getElementById('fetch-ov').classList.add('show');
  setTimeout(() => document.getElementById('fetch-inp').focus(), 80);
}
function closeFetch() { document.getElementById('fetch-ov').classList.remove('show'); }
function ocFetch(e)   { if (e.target.id === 'fetch-ov') closeFetch(); }

function setFst(type, txt) {
  const e = document.getElementById('fetch-st');
  e.className = `sh-st show ${type}`;
  e.textContent = txt;
}

async function doFetch() {
  const path = document.getElementById('fetch-inp').value.trim();
  if (!path) return;
  setFst('info', 'fetching…');
  document.getElementById('fetched-pre').classList.remove('show');
  try {
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
      { headers: { 'Authorization': `Bearer ${CREDS.githubToken}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (!r.ok) throw new Error(r.status === 404 ? 'not found' : `error ${r.status}`);
    const data = await r.json();
    const txt  = b64Decode(data.content.replace(/\n/g, ''));
    const pre  = document.getElementById('fetched-pre');
    pre.textContent = txt; pre.classList.add('show');
    document.getElementById('fetch-st').className = 'sh-st';
  } catch(err) { setFst('err', friendlyError(err)); }
}

function loadFetched() {
  const txt  = document.getElementById('fetched-pre').textContent;
  const path = document.getElementById('fetch-inp').value.trim();
  if (!txt) return;
  S.messages.push({ role: 'user', content: `[Fetched entry: ${path}]\n\n${txt}` });
  addSys(`loaded: ${path}`);
  document.getElementById('chat').scrollTop = document.getElementById('chat').scrollHeight;
  closeFetch();
}

// ── Brief mode ────────────────────────────────────────────────────────────────
const BRIEF_RE = [
  /rough.{0,15}short/i, /keep it short/i, /quick.{0,10}(check|entry)/i,
  /just.{0,8}numbers/i, /exhausted/i, /pagod/i, /maikli/i,
  /fatiguée/i, /tired.{0,10}tonight/i, /matulog na/i,
];

function toggleBrief() {
  S.brief = !S.brief;
  document.getElementById('brief-btn').classList.toggle('on', S.brief);
  addSys(S.brief ? 'brief mode on' : 'brief mode off');
}

// ── Entry + state extraction ──────────────────────────────────────────────────
function extractEntry(txt) {
  const s = txt.indexOf('<<<ENTRY_START>>>');
  const e = txt.indexOf('<<<ENTRY_END>>>');
  if (s === -1 || e === -1) return null;
  return txt.slice(s + 17, e).trim();
}

function extractState(txt) {
  const s = txt.indexOf('<<<STATE_START>>>');
  const e = txt.indexOf('<<<STATE_END>>>');
  if (s === -1 || e === -1) return null;
  return txt.slice(s + 17, e).trim();
}

function extractPatterns(txt) {
  const s = txt.indexOf('<<<PATTERNS_START>>>');
  const e = txt.indexOf('<<<PATTERNS_END>>>');
  if (s === -1 || e === -1) return null;
  return txt.slice(s + 20, e).trim();
}

function extractPeople(txt) {
  const s = txt.indexOf('<<<PEOPLE_START>>>');
  const e = txt.indexOf('<<<PEOPLE_END>>>');
  if (s === -1 || e === -1) return null;
  return txt.slice(s + 18, e).trim();
}

function extractEvolution(txt) {
  const s = txt.indexOf('<<<EVOLUTION_START>>>');
  const e = txt.indexOf('<<<EVOLUTION_END>>>');
  if (s === -1 || e === -1) return null;
  return txt.slice(s + 21, e).trim();
}

function extractChatInsights(txt) {
  const s = txt.indexOf('<<<CHAT_INSIGHTS_START>>>');
  const e = txt.indexOf('<<<CHAT_INSIGHTS_END>>>');
  if (s === -1 || e === -1) return null;
  return txt.slice(s + 25, e).trim();
}

function extractPeopleNotes(txt) {
  const s = txt.indexOf('<<<PEOPLE_NOTES_START>>>');
  const e = txt.indexOf('<<<PEOPLE_NOTES_END>>>');
  if (s === -1 || e === -1) return null;
  return txt.slice(s + 24, e).trim();
}

function extractGoalsSummary(txt) {
  const s = txt.indexOf('<<<GOALS_SUMMARY_START>>>');
  const e = txt.indexOf('<<<GOALS_SUMMARY_END>>>');
  if (s === -1 || e === -1) return null;
  return txt.slice(s + 25, e).trim();
}

function extractReview(txt) {
  const s = txt.indexOf('<<<REVIEW_START>>>');
  const e = txt.indexOf('<<<REVIEW_END>>>');
  if (s === -1 || e === -1) return null;
  return txt.slice(s + 18, e).trim();
}

function detectType(reply) {
  // Check the entry content (not the reply preamble) to avoid misfiling
  const entry = extractEntry(reply) || reply;
  const top   = entry.slice(0, 300);
  if (/psychiatrist/i.test(top))                                return 'psychiatrist';
  if (/rheumatologist/i.test(top))                              return 'rheumatologist';
  if (/# Weekly/i.test(entry)  || /weekly review/i.test(top))  return 'weekly';
  if (/# Monthly/i.test(entry) || /monthly review/i.test(top)) return 'monthly';
  if (/goals/i.test(top))                                       return 'goals';
  return 'daily';
}

// ── GitHub save ───────────────────────────────────────────────────────────────
async function getFileInfo(path) {
  const r = await fetch(
    `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
    { headers: { 'Authorization': `Bearer ${CREDS.githubToken}`, 'Accept': 'application/vnd.github.v3+json' } }
  );
  if (r.status === 404) return { sha: null, content: null };
  if (r.status === 401) throw new Error('github_401');
  if (r.status === 403) throw new Error('github_403');
  if (!r.ok) throw new Error(`GitHub check failed ${r.status}`);
  const data = await r.json();
  return { sha: data.sha, content: b64Decode(data.content.replace(/\n/g, '')) };
}

function setSaveSt(type, txt) {
  const e = document.getElementById('save-st');
  e.className = `show ${type}`; e.textContent = txt;
}

async function saveEntry() {
  if (!S.pendingEntry || !S.pendingPath) return;
  const btn = document.getElementById('save-go');
  btn.disabled = true;
  setSaveSt('info', 'writing…');
  try {
    const { sha } = await getFileInfo(S.pendingPath);

    // Claude produces the complete file (YAML frontmatter + all sections) — save wholesale
    const contentToSave = S.pendingEntry;

    const enc  = b64Encode(contentToSave);
    const body = {
      message: `journal: ${S.pendingPath.split('/').pop().replace('.md', '')}`,
      content: enc,
    };
    if (sha) body.sha = sha;
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${S.pendingPath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CREDS.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) {
      if (r.status === 401) throw new Error('github_401');
      if (r.status === 403) throw new Error('github_403');
      if (r.status === 404) throw new Error('repo not found — check repo name in config');
      if (r.status === 422) throw new Error('file conflict — try fetching and saving again');
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `GitHub error ${r.status}`);
    }
    setSaveSt('ok', 'saved');
    addSys(`saved → ${S.pendingPath}`);
    S.pendingEntry = null; S.pendingPath = null;
    try { localStorage.removeItem('ar_drafts'); } catch(e) {}
    setTimeout(() => {
      document.getElementById('save-bar').classList.remove('show');
      document.getElementById('save-st').className = '';
      if (S._queuedPatterns) {
        const p = S._queuedPatterns;
        S._queuedPatterns = null;
        showPatBar(p);
      }
    }, 2400);
  } catch(err) {
    setSaveSt('err', friendlyError(err));
    btn.disabled = false;
  }
}

function dismissSave() {
  S.pendingEntry = null; S.pendingPath = null;
  document.getElementById('save-bar').classList.remove('show');
  document.getElementById('save-st').className = '';
  if (S._queuedPatterns) {
    const p = S._queuedPatterns;
    S._queuedPatterns = null;
    showPatBar(p);
  }
}

// ── State doc save ────────────────────────────────────────────────────────────
function setStateSt(type, txt) {
  const e = document.getElementById('state-st');
  e.className = `show ${type}`; e.textContent = txt;
}

function showStateBar(content) {
  S.pendingState = content;
  document.getElementById('state-go').disabled = false;
  document.getElementById('state-st').className = '';
  document.getElementById('state-bar').classList.add('show');
}

function dismissState() {
  S.pendingState = null;
  document.getElementById('state-bar').classList.remove('show');
  document.getElementById('state-st').className = '';
}

async function saveState() {
  if (!S.pendingState) return;
  const btn = document.getElementById('state-go');
  btn.disabled = true;
  setStateSt('info', 'writing…');
  try {
    const path = 'notes/state-of-miles.md';
    const { sha } = await getFileInfo(path);
    const body = {
      message: 'state: update state-of-miles.md',
      content: b64Encode(S.pendingState),
    };
    if (sha) body.sha = sha;
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CREDS.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) {
      if (r.status === 401) throw new Error('github_401');
      if (r.status === 403) throw new Error('github_403');
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `GitHub error ${r.status}`);
    }
    S.stateOfMiles = S.pendingState; // update in-memory so current session uses new doc
    setStateSt('ok', 'saved');
    addSys('state doc updated → notes/state-of-miles.md');
    S.pendingState = null;
    setTimeout(() => {
      document.getElementById('state-bar').classList.remove('show');
      document.getElementById('state-st').className = '';
    }, 2400);
  } catch(err) {
    setStateSt('err', friendlyError(err));
    btn.disabled = false;
  }
}

// ── Patterns doc save ─────────────────────────────────────────────────────────
function setPatSt(type, txt) {
  const e = document.getElementById('pat-st');
  e.className = `show ${type}`; e.textContent = txt;
}

function showPatBar(content) {
  S.pendingPatterns = content;
  document.getElementById('pat-go').disabled = false;
  document.getElementById('pat-st').className = '';
  document.getElementById('pat-bar').classList.add('show');
}

function dismissPatterns() {
  S.pendingPatterns = null;
  document.getElementById('pat-bar').classList.remove('show');
  document.getElementById('pat-st').className = '';
  if (S._queuedGoalsSummary) {
    const gs = S._queuedGoalsSummary; S._queuedGoalsSummary = null; showGoalsSummaryBar(gs);
  } else if (S._queuedInsights) {
    const i = S._queuedInsights; S._queuedInsights = null; showInsightsBar(i);
  } else if (S._queuedPeople) {
    const p = S._queuedPeople; S._queuedPeople = null; showPeopleBar(p);
  } else if (S._queuedPeopleNotes) {
    const pn = S._queuedPeopleNotes; S._queuedPeopleNotes = null; showPeopleNotesBar(pn);
  } else if (S._queuedEvolution) {
    const e = S._queuedEvolution; S._queuedEvolution = null; showEvoBar(e);
  }
}

async function savePatterns() {
  if (!S.pendingPatterns) return;
  const btn = document.getElementById('pat-go');
  btn.disabled = true;
  setPatSt('info', 'writing…');
  try {
    const path = 'notes/patterns.md';
    const { sha } = await getFileInfo(path);
    const body = {
      message: 'patterns: update notes/patterns.md',
      content: b64Encode(S.pendingPatterns),
    };
    if (sha) body.sha = sha;
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CREDS.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) {
      if (r.status === 401) throw new Error('github_401');
      if (r.status === 403) throw new Error('github_403');
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `GitHub error ${r.status}`);
    }
    S.patterns = S.pendingPatterns;
    setPatSt('ok', 'saved');
    addSys('patterns updated → notes/patterns.md');
    S.pendingPatterns = null;
    setTimeout(() => {
      document.getElementById('pat-bar').classList.remove('show');
      document.getElementById('pat-st').className = '';
      if (S._queuedGoalsSummary) {
        const gs = S._queuedGoalsSummary; S._queuedGoalsSummary = null; showGoalsSummaryBar(gs);
      } else if (S._queuedInsights) {
        const i = S._queuedInsights; S._queuedInsights = null; showInsightsBar(i);
      } else if (S._queuedPeople) {
        const p = S._queuedPeople; S._queuedPeople = null; showPeopleBar(p);
      } else if (S._queuedPeopleNotes) {
        const pn = S._queuedPeopleNotes; S._queuedPeopleNotes = null; showPeopleNotesBar(pn);
      } else if (S._queuedEvolution) {
        const e = S._queuedEvolution; S._queuedEvolution = null; showEvoBar(e);
      }
    }, 2400);
  } catch(err) {
    setPatSt('err', friendlyError(err));
    btn.disabled = false;
  }
}

// ── Goals summary save ────────────────────────────────────────────────────────
function setGoalsSummarySt(type, txt) {
  const e = document.getElementById('goals-summary-st');
  e.className = `show ${type}`; e.textContent = txt;
}

function showGoalsSummaryBar(content) {
  S.pendingGoalsSummary = content;
  document.getElementById('goals-summary-go').disabled = false;
  document.getElementById('goals-summary-st').className = '';
  document.getElementById('goals-summary-bar').classList.add('show');
}

function dismissGoalsSummary() {
  S.pendingGoalsSummary = null;
  document.getElementById('goals-summary-bar').classList.remove('show');
  document.getElementById('goals-summary-st').className = '';
  if (S._queuedInsights) {
    const i = S._queuedInsights; S._queuedInsights = null; showInsightsBar(i);
  } else if (S._queuedPeople) {
    const p = S._queuedPeople; S._queuedPeople = null; showPeopleBar(p);
  } else if (S._queuedPeopleNotes) {
    const pn = S._queuedPeopleNotes; S._queuedPeopleNotes = null; showPeopleNotesBar(pn);
  } else if (S._queuedEvolution) {
    const e = S._queuedEvolution; S._queuedEvolution = null; showEvoBar(e);
  }
}

async function saveGoalsSummary() {
  if (!S.pendingGoalsSummary) return;
  const btn = document.getElementById('goals-summary-go');
  btn.disabled = true;
  setGoalsSummarySt('info', 'writing…');
  try {
    const path = 'notes/goals-summary.md';
    const { sha } = await getFileInfo(path);
    const body = {
      message: 'goals-summary: update notes/goals-summary.md',
      content: b64Encode(S.pendingGoalsSummary),
    };
    if (sha) body.sha = sha;
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CREDS.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) {
      if (r.status === 401) throw new Error('github_401');
      if (r.status === 403) throw new Error('github_403');
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `GitHub error ${r.status}`);
    }
    S.goals = S.pendingGoalsSummary;
    setGoalsSummarySt('ok', 'saved');
    addSys('goals summary updated → notes/goals-summary.md');
    S.pendingGoalsSummary = null;
    setTimeout(() => {
      document.getElementById('goals-summary-bar').classList.remove('show');
      document.getElementById('goals-summary-st').className = '';
      if (S._queuedInsights) {
        const i = S._queuedInsights; S._queuedInsights = null; showInsightsBar(i);
      } else if (S._queuedPeople) {
        const p = S._queuedPeople; S._queuedPeople = null; showPeopleBar(p);
      } else if (S._queuedPeopleNotes) {
        const pn = S._queuedPeopleNotes; S._queuedPeopleNotes = null; showPeopleNotesBar(pn);
      } else if (S._queuedEvolution) {
        const e = S._queuedEvolution; S._queuedEvolution = null; showEvoBar(e);
      }
    }, 2400);
  } catch(err) {
    setGoalsSummarySt('err', friendlyError(err));
    btn.disabled = false;
  }
}

// ── Chat insights save ────────────────────────────────────────────────────────
function setInsightsSt(type, txt) {
  const e = document.getElementById('insights-st');
  e.className = `show ${type}`; e.textContent = txt;
}

function showInsightsBar(content) {
  S.pendingInsights = content;
  document.getElementById('insights-go').disabled = false;
  document.getElementById('insights-st').className = '';
  document.getElementById('insights-bar').classList.add('show');
}

function dismissInsights() {
  S.pendingInsights = null;
  document.getElementById('insights-bar').classList.remove('show');
  document.getElementById('insights-st').className = '';
  if (S._queuedPeople) {
    const p = S._queuedPeople; S._queuedPeople = null; showPeopleBar(p);
  } else if (S._queuedPeopleNotes) {
    const pn = S._queuedPeopleNotes; S._queuedPeopleNotes = null; showPeopleNotesBar(pn);
  } else if (S._queuedEvolution) {
    const e = S._queuedEvolution; S._queuedEvolution = null; showEvoBar(e);
  }
}

async function saveInsights() {
  if (!S.pendingInsights) return;
  const btn = document.getElementById('insights-go');
  btn.disabled = true;
  setInsightsSt('info', 'writing…');
  try {
    const path = 'notes/chat-insights.md';
    const { sha } = await getFileInfo(path);
    const body = {
      message: 'insights: update notes/chat-insights.md',
      content: b64Encode(S.pendingInsights),
    };
    if (sha) body.sha = sha;
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CREDS.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) {
      if (r.status === 401) throw new Error('github_401');
      if (r.status === 403) throw new Error('github_403');
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `GitHub error ${r.status}`);
    }
    S.chatInsights = S.pendingInsights;
    setInsightsSt('ok', 'saved');
    addSys('insights updated → notes/chat-insights.md');
    S.pendingInsights = null;
    setTimeout(() => {
      document.getElementById('insights-bar').classList.remove('show');
      document.getElementById('insights-st').className = '';
      if (S._queuedPeople) {
        const p = S._queuedPeople; S._queuedPeople = null; showPeopleBar(p);
      } else if (S._queuedPeopleNotes) {
        const pn = S._queuedPeopleNotes; S._queuedPeopleNotes = null; showPeopleNotesBar(pn);
      } else if (S._queuedEvolution) {
        const e = S._queuedEvolution; S._queuedEvolution = null; showEvoBar(e);
      }
    }, 2400);
  } catch(err) {
    setInsightsSt('err', friendlyError(err));
    btn.disabled = false;
  }
}

// ── People profile save ───────────────────────────────────────────────────────
function setPeopleSt(type, txt) {
  const e = document.getElementById('people-st');
  e.className = `show ${type}`; e.textContent = txt;
}

function showPeopleBar(content) {
  S.pendingPeople = content;
  document.getElementById('people-go').disabled = false;
  document.getElementById('people-st').className = '';
  document.getElementById('people-bar').classList.add('show');
}

function dismissPeople() {
  S.pendingPeople = null;
  document.getElementById('people-bar').classList.remove('show');
  document.getElementById('people-st').className = '';
  if (S._queuedPeopleNotes) {
    const pn = S._queuedPeopleNotes; S._queuedPeopleNotes = null; showPeopleNotesBar(pn);
  } else if (S._queuedEvolution) {
    const e = S._queuedEvolution; S._queuedEvolution = null; showEvoBar(e);
  }
}

async function savePeople() {
  if (!S.pendingPeople) return;
  const btn = document.getElementById('people-go');
  btn.disabled = true;
  setPeopleSt('info', 'writing…');
  try {
    const path = 'notes/people-profile.md';
    const { sha } = await getFileInfo(path);
    const body = { message: 'people: update notes/people-profile.md', content: b64Encode(S.pendingPeople) };
    if (sha) body.sha = sha;
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
      { method: 'PUT', headers: { 'Authorization': `Bearer ${CREDS.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!r.ok) {
      if (r.status === 401) throw new Error('github_401');
      if (r.status === 403) throw new Error('github_403');
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `GitHub error ${r.status}`);
    }
    S.peopleProfile = S.pendingPeople;
    setPeopleSt('ok', 'saved');
    addSys('people profile updated → notes/people-profile.md');
    S.pendingPeople = null;
    setTimeout(() => {
      document.getElementById('people-bar').classList.remove('show');
      document.getElementById('people-st').className = '';
      if (S._queuedPeopleNotes) {
        const pn = S._queuedPeopleNotes; S._queuedPeopleNotes = null; showPeopleNotesBar(pn);
      } else if (S._queuedEvolution) {
        const e = S._queuedEvolution; S._queuedEvolution = null; showEvoBar(e);
      }
    }, 2400);
  } catch(err) {
    setPeopleSt('err', friendlyError(err));
    btn.disabled = false;
  }
}

// ── People notes save ─────────────────────────────────────────────────────────
function setPeopleNotesSt(type, txt) {
  const e = document.getElementById('people-notes-st');
  e.className = `show ${type}`; e.textContent = txt;
}

function showPeopleNotesBar(content) {
  S.pendingPeopleNotes = content;
  document.getElementById('people-notes-go').disabled = false;
  document.getElementById('people-notes-st').className = '';
  document.getElementById('people-notes-bar').classList.add('show');
}

function dismissPeopleNotes() {
  S.pendingPeopleNotes = null;
  document.getElementById('people-notes-bar').classList.remove('show');
  document.getElementById('people-notes-st').className = '';
  if (S._queuedEvolution) {
    const e = S._queuedEvolution; S._queuedEvolution = null; showEvoBar(e);
  }
}

async function savePeopleNotes() {
  if (!S.pendingPeopleNotes) return;
  const btn = document.getElementById('people-notes-go');
  btn.disabled = true;
  setPeopleNotesSt('info', 'writing…');
  try {
    const path = 'notes/people-notes.md';
    const { sha } = await getFileInfo(path);
    const body = { message: 'people-notes: update notes/people-notes.md', content: b64Encode(S.pendingPeopleNotes) };
    if (sha) body.sha = sha;
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
      { method: 'PUT', headers: { 'Authorization': `Bearer ${CREDS.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!r.ok) {
      if (r.status === 401) throw new Error('github_401');
      if (r.status === 403) throw new Error('github_403');
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `GitHub error ${r.status}`);
    }
    S.peopleNotes = S.pendingPeopleNotes;
    setPeopleNotesSt('ok', 'saved');
    addSys('people notes updated → notes/people-notes.md');
    S.pendingPeopleNotes = null;
    setTimeout(() => {
      document.getElementById('people-notes-bar').classList.remove('show');
      document.getElementById('people-notes-st').className = '';
      if (S._queuedEvolution) {
        const e = S._queuedEvolution; S._queuedEvolution = null; showEvoBar(e);
      }
    }, 2400);
  } catch(err) {
    setPeopleNotesSt('err', friendlyError(err));
    btn.disabled = false;
  }
}

// ── Review save ───────────────────────────────────────────────────────────────
function setReviewSt(type, txt) {
  const e = document.getElementById('review-st');
  e.className = `show ${type}`; e.textContent = txt;
}

function showReviewBar(content) {
  S.pendingReview = content;
  document.getElementById('review-go').disabled = false;
  document.getElementById('review-st').className = '';
  document.getElementById('review-bar').classList.add('show');
}

function dismissReview() {
  S.pendingReview = null;
  document.getElementById('review-bar').classList.remove('show');
  document.getElementById('review-st').className = '';
  if (S._queuedGoalsSummary) {
    const gs = S._queuedGoalsSummary; S._queuedGoalsSummary = null; showGoalsSummaryBar(gs);
  } else if (S._queuedPeople) {
    const p = S._queuedPeople; S._queuedPeople = null; showPeopleBar(p);
  } else if (S._queuedPeopleNotes) {
    const pn = S._queuedPeopleNotes; S._queuedPeopleNotes = null; showPeopleNotesBar(pn);
  }
}

async function saveReview() {
  if (!S.pendingReview) return;
  const btn = document.getElementById('review-go');
  btn.disabled = true;
  setReviewSt('info', 'writing…');
  try {
    const path = 'goals/review-log.md';
    const { sha } = await getFileInfo(path);
    const merged = mergeReviewEntry(S.existingReview, S.pendingReview);
    const body = {
      message: 'review: update goals/review-log.md',
      content: b64Encode(merged),
    };
    if (sha) body.sha = sha;
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CREDS.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) {
      if (r.status === 401) throw new Error('github_401');
      if (r.status === 403) throw new Error('github_403');
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `GitHub error ${r.status}`);
    }
    S.reviewLog = merged;
    setReviewSt('ok', 'saved');
    addSys('review saved → goals/review-log.md');
    S.pendingReview = null;
    setTimeout(() => {
      document.getElementById('review-bar').classList.remove('show');
      document.getElementById('review-st').className = '';
      if (S._queuedGoalsSummary) {
        const gs = S._queuedGoalsSummary; S._queuedGoalsSummary = null; showGoalsSummaryBar(gs);
      } else if (S._queuedPeople) {
        const p = S._queuedPeople; S._queuedPeople = null; showPeopleBar(p);
      } else if (S._queuedPeopleNotes) {
        const pn = S._queuedPeopleNotes; S._queuedPeopleNotes = null; showPeopleNotesBar(pn);
      }
    }, 2400);
  } catch(err) {
    setReviewSt('err', friendlyError(err));
    btn.disabled = false;
  }
}

// ── Evolution save ────────────────────────────────────────────────────────────
function setEvoSt(type, txt) {
  const e = document.getElementById('evo-st');
  e.className = `show ${type}`; e.textContent = txt;
}

function showEvoBar(content) {
  S.pendingEvolution = content;
  document.getElementById('evo-go').disabled = false;
  document.getElementById('evo-st').className = '';
  document.getElementById('evo-bar').classList.add('show');
}

function dismissEvolution() {
  S.pendingEvolution = null;
  document.getElementById('evo-bar').classList.remove('show');
  document.getElementById('evo-st').className = '';
}

async function saveEvolution() {
  if (!S.pendingEvolution) return;
  const btn = document.getElementById('evo-go');
  btn.disabled = true;
  setEvoSt('info', 'writing…');
  try {
    const path = 'notes/evolution.md';
    const { sha } = await getFileInfo(path);
    const body = { message: 'evolution: update notes/evolution.md', content: b64Encode(S.pendingEvolution) };
    if (sha) body.sha = sha;
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
      { method: 'PUT', headers: { 'Authorization': `Bearer ${CREDS.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!r.ok) {
      if (r.status === 401) throw new Error('github_401');
      if (r.status === 403) throw new Error('github_403');
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `GitHub error ${r.status}`);
    }
    S.evolution = S.pendingEvolution;
    S.evoTrigger = false;
    try { localStorage.setItem('ar_evo_offered', S.sessionDate); } catch(e) {}
    setEvoSt('ok', 'saved');
    addSys('evolution updated → notes/evolution.md');
    S.pendingEvolution = null;
    setTimeout(() => {
      document.getElementById('evo-bar').classList.remove('show');
      document.getElementById('evo-st').className = '';
    }, 2400);
  } catch(err) {
    setEvoSt('err', friendlyError(err));
    btn.disabled = false;
  }
}

function showSaveBar(entry, type) {
  S.pendingEntry = entry;
  S.pendingPath  = pathFor(type, S.sessionDate);
  document.getElementById('save-path').textContent = S.pendingPath;
  document.getElementById('save-go').disabled = false;
  document.getElementById('save-st').className = '';
  document.getElementById('save-bar').classList.add('show');
}

// ── Claude API (with one retry) ───────────────────────────────────────────────
async function callClaude(messages, sysOverride = null, retrying = false) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CREDS.anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 2500,
        system:     sysOverride || buildSysPrompt(),
        messages,
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error?.message || `API error ${r.status}`);
    }
    const data = await r.json();
    if (!data.content?.[0]?.text) throw new Error('empty response');
    return data.content[0].text;
  } catch(err) {
    if (!retrying && (err.message.includes('network') || err.message.includes('fetch') || err.message.includes('Failed'))) {
      await new Promise(r => setTimeout(r, 1200));
      return callClaude(messages, sysOverride, true);
    }
    throw err;
  }
}

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMsg() {
  const inp = document.getElementById('inp');
  const txt = inp.value.trim();
  if (!txt || S.thinking) return;

  if (!S.brief && BRIEF_RE.some(t => t.test(txt))) {
    S.brief = true;
    document.getElementById('brief-btn').classList.add('on');
    addSys('brief mode on');
  }

  inp.value = ''; inp.style.height = 'auto';
  addMsg('user', txt);
  S.messages.push({ role: 'user', content: txt });
  saveDraft();

  S.thinking = true;
  document.getElementById('send-btn').disabled = true;
  setStat('thinking', '…');
  showDots();

  try {
    const reply = await callClaude(S.messages);
    hideDots();
    const entry        = S.reviewMode ? null : extractEntry(reply);
    const review       = S.reviewMode ? extractReview(reply) : null;
    const state        = extractState(reply);
    const patterns     = extractPatterns(reply);
    const goalsSummary = extractGoalsSummary(reply);
    const insights     = extractChatInsights(reply);
    const people       = extractPeople(reply);
    const peopleNotes  = extractPeopleNotes(reply);
    const evolution    = extractEvolution(reply);
    const deepFetch = reply.includes('<<<FETCH_DEEP>>>');
    // Strip all markers from displayed text
    let disp = reply;
    if (review)       disp = disp.replace(/<<<REVIEW_START>>>[\s\S]*?<<<REVIEW_END>>>/g, '').trim() || 'Review ready.';
    if (entry)        disp = disp.slice(0, disp.indexOf('<<<ENTRY_START>>>')).trim() || 'Entry ready.';
    if (state)        disp = disp.replace(/<<<STATE_START>>>[\s\S]*?<<<STATE_END>>>/g, '').trim();
    if (patterns)     disp = disp.replace(/<<<PATTERNS_START>>>[\s\S]*?<<<PATTERNS_END>>>/g, '').trim();
    if (goalsSummary) disp = disp.replace(/<<<GOALS_SUMMARY_START>>>[\s\S]*?<<<GOALS_SUMMARY_END>>>/g, '').trim();
    if (insights)     disp = disp.replace(/<<<CHAT_INSIGHTS_START>>>[\s\S]*?<<<CHAT_INSIGHTS_END>>>/g, '').trim();
    if (people)       disp = disp.replace(/<<<PEOPLE_START>>>[\s\S]*?<<<PEOPLE_END>>>/g, '').trim();
    if (peopleNotes)  disp = disp.replace(/<<<PEOPLE_NOTES_START>>>[\s\S]*?<<<PEOPLE_NOTES_END>>>/g, '').trim();
    if (evolution)    disp = disp.replace(/<<<EVOLUTION_START>>>[\s\S]*?<<<EVOLUTION_END>>>/g, '').trim();
    disp = disp.replace(/<<<FETCH_DEEP>>>/g, '').trim();
    addMsg('assistant', disp || 'Done.');
    S.messages.push({ role: 'assistant', content: reply });
    saveDraft();
    if (state) showStateBar(state);
    // First bar in cascade: review bar (review mode) or entry bar (daily mode)
    const firstBar = S.reviewMode ? review : entry;
    // Queue order (daily):  entry → patterns → goals-summary → insights → people → people-notes → evolution
    // Queue order (review): review → goals-summary → people-notes → people-profile
    if (patterns) {
      if (firstBar) S._queuedPatterns = patterns;
      else showPatBar(patterns);
    }
    if (goalsSummary) {
      if (firstBar || patterns) S._queuedGoalsSummary = goalsSummary;
      else showGoalsSummaryBar(goalsSummary);
    }
    if (insights) {
      if (firstBar || patterns || goalsSummary) S._queuedInsights = insights;
      else showInsightsBar(insights);
    }
    if (people) {
      if (firstBar || patterns || goalsSummary || insights) S._queuedPeople = people;
      else showPeopleBar(people);
    }
    if (peopleNotes) {
      if (firstBar || patterns || goalsSummary || insights || people) S._queuedPeopleNotes = peopleNotes;
      else showPeopleNotesBar(peopleNotes);
    }
    if (evolution) {
      if (firstBar || patterns || goalsSummary || insights || people || peopleNotes) S._queuedEvolution = evolution;
      else showEvoBar(evolution);
    }
    if (review) showReviewBar(review);
    else if (entry) showSaveBar(entry, detectType(reply));
    setStat('ready', S.reviewMode ? `review — ${S.sessionDate}` : `ready — ${S.sessionDate}`);
    // Trigger deep context fetch in background if signaled
    if (deepFetch && !S.deepFetched) {
      S.deepFetched = true;
      setStat('thinking', 'pulling more context…');
      fetchDeepEntries().then(deepEntries => {
        if (deepEntries.length) {
          const ctx = 'DEEPER CONTEXT\n' + deepEntries.map(e => `--- ${e.date} ---\n${compressEntry(e.content)}`).join('\n\n');
          S.messages.push({ role: 'user', content: ctx });
          addSys('deeper context loaded');
        }
        setStat('ready', `ready — ${S.sessionDate}`);
      }).catch(() => setStat('ready', `ready — ${S.sessionDate}`));
    }
  } catch(err) {
    hideDots();
    addSys(`error: ${friendlyError(err)}`);
    setStat('error', friendlyError(err));
  } finally {
    S.thinking = false;
    document.getElementById('send-btn').disabled = false;
  }
}

// ── New session ───────────────────────────────────────────────────────────────
function newSess() {
  if (S.messages.length > 0) {
    inlineConfirm('clear this session?', function() {
      _clearAndStart();
    });
    return;
  }
  _clearAndStart();
}

function _clearAndStart() {
  S.messages = []; S.pendingEntry = null; S.pendingPath = null; S.pendingState = null;
  S.brief = false; S.existingEntry = null; S.recentEntries = []; S.stateOfMiles = null;
  S.goals = null; S.patterns = null; S.pendingPatterns = null;
  S.chatInsights = null; S.pendingInsights = null; S._queuedInsights = null;
  S.pendingGoalsSummary = null; S._queuedGoalsSummary = null;
  S.deepFetched = false; S._queuedPatterns = null;
  S.peopleProfile = null; S.pendingPeople = null; S._queuedPeople = null;
  S.peopleNotes = null; S.pendingPeopleNotes = null; S._queuedPeopleNotes = null;
  S.evolution = null; S.pendingEvolution = null; S.evoTrigger = false; S._queuedEvolution = null;
  S.reviewMode = false; S.pendingReview = null; S.existingReview = null; S.reviewLog = null;
  document.getElementById('pat-bar').classList.remove('show');
  document.getElementById('pat-st').className = '';
  document.getElementById('goals-summary-bar').classList.remove('show');
  document.getElementById('goals-summary-st').className = '';
  document.getElementById('insights-bar').classList.remove('show');
  document.getElementById('insights-st').className = '';
  document.getElementById('state-bar').classList.remove('show');
  document.getElementById('state-st').className = '';
  document.getElementById('people-bar').classList.remove('show');
  document.getElementById('people-st').className = '';
  document.getElementById('people-notes-bar').classList.remove('show');
  document.getElementById('people-notes-st').className = '';
  document.getElementById('evo-bar').classList.remove('show');
  document.getElementById('evo-st').className = '';
  document.getElementById('brief-btn').classList.remove('on');
  document.getElementById('review-btn').classList.remove('on');
  document.getElementById('review-bar').classList.remove('show');
  document.getElementById('review-st').className = '';
  document.getElementById('chat').innerHTML = '';
  document.getElementById('save-bar').classList.remove('show');
  document.getElementById('save-st').className = '';
  document.getElementById('save-go').disabled = false;
  _initSessionMeta();
  startSess();
}

function _initSessionMeta() {
  const today = todayManila();
  if (hourManila() < 3) {
    const [y, m, d] = today.split('-').map(Number);
    S.sessionDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(Date.UTC(y, m - 1, d - 1)));
  } else {
    S.sessionDate = today;
  }
  const [y, m, d] = S.sessionDate.split('-').map(Number);
  const sessionDt = new Date(Date.UTC(y, m - 1, d));
  S.sessionDow = dowManila(sessionDt);
  S.sessionDay = dayIndexManila(sessionDt);
  document.getElementById('wm-date').textContent = S.sessionDate;
}

// ── Generic GitHub file fetcher (silent) ─────────────────────────────────────
async function fetchEntry(path) {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${CREDS.repo}/contents/${path}`,
      { headers: { 'Authorization': `Bearer ${CREDS.githubToken}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return b64Decode(data.content.replace(/\n/g, ''));
  } catch(e) {
    return null;
  }
}

function fetchTodayEntry() {
  return fetchEntry(`journal/daily/${S.sessionDate.slice(0,4)}/${S.sessionDate}.md`);
}

// ── Compress entry: YAML frontmatter + first Narrative paragraph only ─────────
function compressEntry(content) {
  if (!content) return '';
  const parts = [];
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) parts.push(content.slice(0, end + 4));
  }
  const narrativeIdx = content.indexOf('## Narrative');
  if (narrativeIdx !== -1) {
    const after = content.slice(narrativeIdx + 12).trim();
    const paraEnd = after.indexOf('\n\n');
    const para = paraEnd !== -1 ? after.slice(0, paraEnd) : after.slice(0, 400);
    if (para) parts.push('## Narrative\n' + para);
  }
  return parts.join('\n\n') || content.slice(0, 500);
}

function fetchGoals()         { return fetchEntry('notes/goals-summary.md'); }
function fetchGoalsFull()     { return fetchEntry('goals/current.md'); }
function fetchPatterns()      { return fetchEntry('notes/patterns.md'); }
function fetchChatInsights()  { return fetchEntry('notes/chat-insights.md'); }
function fetchPeopleProfile() { return fetchEntry('notes/people-profile.md'); }
function fetchPeopleNotes()   { return fetchEntry('notes/people-notes.md'); }
function fetchEvolution()     { return fetchEntry('notes/evolution.md'); }
function fetchReviewLog()     { return fetchEntry('goals/review-log.md'); }

function parseEvolutionDate(content) {
  if (!content) return null;
  const m = content.match(/last_updated:\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function parseLastReviewDate(content) {
  if (!content) return null;
  const matches = [...content.matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

function hasIncompleteReview(content) {
  if (!content) return false;
  const lastBlock = content.lastIndexOf('\n## ');
  if (lastBlock === -1 && !content.startsWith('## ')) return false;
  const blockStart = lastBlock === -1 ? 0 : lastBlock + 1;
  const block = content.slice(blockStart);
  return /\*\*Status: incomplete\*\*/i.test(block);
}

function mergeReviewEntry(existingContent, newBlock) {
  if (!existingContent || !hasIncompleteReview(existingContent)) {
    return existingContent ? existingContent + '\n\n---\n\n' + newBlock : newBlock;
  }
  // Find the last ## YYYY-MM-DD block and replace it
  const lastIdx = existingContent.lastIndexOf('\n## ');
  const blockStart = lastIdx === -1 ? 0 : lastIdx + 1;
  return existingContent.slice(0, blockStart).trimEnd() + (blockStart > 0 ? '\n\n---\n\n' : '') + newBlock;
}

function _computeEvoTrigger(evolutionContent) {
  const lastDate = parseEvolutionDate(evolutionContent);
  const daysSince = lastDate
    ? Math.floor((Date.now() - new Date(lastDate + 'T00:00:00Z')) / 86400000)
    : 999;
  let lastOffered = null;
  try { lastOffered = localStorage.getItem('ar_evo_offered'); } catch(e) {}
  const daysSinceOffered = lastOffered
    ? Math.floor((Date.now() - new Date(lastOffered + 'T00:00:00Z')) / 86400000)
    : 999;
  return daysSince >= 90 && daysSinceOffered >= 7;
}

// ── Fetch entries 4–14 days ago in parallel (triggered by <<<FETCH_DEEP>>>) ───
async function fetchDeepEntries() {
  const dates = [4,5,6,7,8,9,10,11,12,13,14].map(n => daysAgo(S.sessionDate, n));
  const results = await Promise.allSettled(
    dates.map(date =>
      fetchEntry(`journal/daily/${date.slice(0,4)}/${date}.md`).then(content => content ? { date, content } : null)
    )
  );
  return results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
}

// ── Date helper — subtract N days from a YYYY-MM-DD string ───────────────────
function daysAgo(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}

// ── Fetch last 3 daily entries in parallel ────────────────────────────────────
async function fetchRecentEntries() {
  const dates = [1, 2, 3].map(n => daysAgo(S.sessionDate, n));
  const results = await Promise.allSettled(
    dates.map(date =>
      fetchEntry(`journal/daily/${date.slice(0,4)}/${date}.md`).then(content => content ? { date, content } : null)
    )
  );
  return results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
}

// ── Fetch State of Miles doc ──────────────────────────────────────────────────
function fetchStateOfMiles() {
  return fetchEntry('notes/state-of-miles.md');
}

// ── Parse graymatter scores from YAML frontmatter ────────────────────────────
function parseGraymatter(content) {
  if (!content || !content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const yaml = content.slice(3, end);

  const gmIdx = yaml.indexOf('graymatter:');
  if (gmIdx === -1) return null;
  const gmSection = yaml.slice(gmIdx + 11);

  const labelMap = {
    energy:        'Energy',
    pain:          'Pain/Inflammation',
    sleep_quality: 'Sleep Quality',
    diet:          'Diet Adherence',
    hydration:     'Hydration',
    mood:          'Mood',
    anxiety:       'Anxiety',
    motivation:    'Motivation',
    social:        'Social Connection',
    clarity:       'Cognitive Clarity',
  };

  const scores = {};
  for (const line of gmSection.split('\n')) {
    const m = line.match(/^\s{2}(\w+):\s*(\d)/);
    if (!m) continue;
    const label = labelMap[m[1]];
    if (label) scores[label] = parseInt(m[2]);
  }
  return Object.keys(scores).length ? scores : null;
}

// ── Build graymatter trend string for system prompt ───────────────────────────
function buildGraymatterTrend(entries) {
  const rows = entries
    .map(e => ({ date: e.date, scores: parseGraymatter(e.content) }))
    .filter(e => e.scores);
  if (!rows.length) return '';
  const lines = rows.map(({ date, scores }) =>
    `${date}: ` + Object.entries(scores).map(([k, v]) => `${k} ${v}/5`).join(' · ')
  );
  return `RECENT GRAYMATTER (last ${rows.length} days)\n${lines.join('\n')}`;
}

// ── Load session context — used at start + on draft restore ──────────────────
async function loadSessionContext() {
  const [recentEntries, stateOfMiles, goals, patterns, chatInsights, peopleProfile, peopleNotes, evolution, reviewLog] = await Promise.all([
    fetchRecentEntries(),
    fetchStateOfMiles(),
    fetchGoals(),
    fetchPatterns(),
    fetchChatInsights(),
    fetchPeopleProfile(),
    fetchPeopleNotes(),
    fetchEvolution(),
    fetchReviewLog(),
  ]);
  S.recentEntries = recentEntries;
  S.stateOfMiles  = stateOfMiles;
  S.goals         = goals;
  S.patterns      = patterns;
  S.chatInsights  = chatInsights;
  S.peopleProfile = peopleProfile;
  S.peopleNotes   = peopleNotes;
  S.evolution     = evolution;
  S.reviewLog     = reviewLog;
  S.evoTrigger    = _computeEvoTrigger(evolution);
  if (S.evoTrigger) { try { localStorage.setItem('ar_evo_offered', S.sessionDate); } catch(e) {} }
}

// ── Start session ─────────────────────────────────────────────────────────────
async function startSess() {
  setStat('thinking', '…');
  S.thinking = true;
  document.getElementById('send-btn').disabled = true;
  showDots();

  const h = hourManila();
  const timeHint = h < 8 ? 'early morning' : h >= 22 ? 'late night' : h >= 18 ? 'evening' : 'daytime';

  // Fetch today's entry + recent days + state doc + goals + patterns + chat insights + people + evolution + review log in parallel
  const [existing, recentEntries, stateOfMiles, goals, patterns, chatInsights, peopleProfile, peopleNotes, evolution, reviewLog] = await Promise.all([
    fetchTodayEntry(),
    fetchRecentEntries(),
    fetchStateOfMiles(),
    fetchGoals(),
    fetchPatterns(),
    fetchChatInsights(),
    fetchPeopleProfile(),
    fetchPeopleNotes(),
    fetchEvolution(),
    fetchReviewLog(),
  ]);
  S.existingEntry  = existing;
  S.recentEntries  = recentEntries;
  S.stateOfMiles   = stateOfMiles;
  S.goals          = goals;
  S.patterns       = patterns;
  S.chatInsights   = chatInsights;
  S.peopleProfile  = peopleProfile;
  S.peopleNotes    = peopleNotes;
  S.evolution      = evolution;
  S.reviewLog      = reviewLog;
  S.evoTrigger     = _computeEvoTrigger(evolution);
  if (S.evoTrigger) { try { localStorage.setItem('ar_evo_offered', S.sessionDate); } catch(e) {} }

  const openingContent = existing
    ? `Start the journal session. It is ${timeHint} in Manila. Today already has an entry — load it as context and treat this as a continuation of the same day. When producing the final entry, merge and combine both sessions into one cohesive document — preserve the earlier narrative, append new material, and update graymatter to reflect the full day.

EXISTING ENTRY:
${existing}`
    : `Start the journal session. It is ${timeHint} in Manila.`;

  try {
    const opening = [{ role: 'user', content: openingContent }];
    const reply = await callClaude(opening);
    hideDots();

    if (existing) {
      addSys("today's entry loaded — continuing from earlier");
    }

    addMsg('assistant', reply);
    S.messages = [
      { role: 'user', content: openingContent },
      { role: 'assistant', content: reply },
    ];
    saveDraft();
    setStat('ready', `ready — ${S.sessionDate}`);
  } catch(err) {
    hideDots();
    addSys(`could not connect: ${friendlyError(err)}`);
    setStat('error', 'connection failed');
  } finally {
    S.thinking = false;
    document.getElementById('send-btn').disabled = false;
  }
}

// ── Draft restore ─────────────────────────────────────────────────────────────
function restoreDraft(draft) {
  const mins = Math.round((Date.now() - draft.ts) / 60000);
  S.messages    = draft.messages;
  S.sessionDate = draft.date || S.sessionDate;
  S.brief       = draft.brief || false;
  document.getElementById('brief-btn').classList.toggle('on', S.brief);
  document.getElementById('wm-date').textContent = S.sessionDate;
  document.getElementById('chat').innerHTML = '';

  // Show only last 3 exchanges for clean restore, collapse earlier
  const allMsgs = S.messages.filter(m =>
    !(m.role === 'user' && m.content.startsWith('Start the journal session'))
  );
  const recent  = allMsgs.slice(-6); // last 3 pairs
  const earlier = allMsgs.slice(0, -6);

  if (earlier.length > 0) {
    addSys(`${Math.floor(earlier.length / 2)} earlier exchange${earlier.length > 2 ? 's' : ''} hidden`);
  }

  addSys(`draft from ${mins < 1 ? 'just now' : mins + 'm ago'} — continue or tap new`);

  recent.forEach(m => {
    if (m.role === 'user') {
      addMsg('user', m.content);
    } else if (m.role === 'assistant') {
      const disp = m.content.includes('<<<ENTRY_START>>>')
        ? (m.content.slice(0, m.content.indexOf('<<<ENTRY_START>>>')).trim() || 'Entry was ready.')
        : m.content;
      addMsg('assistant', disp);
    }
  });

  setStat('ready', `draft — ${S.sessionDate}`);

  // Background-load context so system prompt is populated when next message fires
  loadSessionContext();
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  _initSessionMeta();

  if (!credsReady()) {
    setStat('', 'setup required');
    addSys('tap ⚙ to enter your API keys');
    openCfg();
    return;
  }

  const draft = loadDraft();
  if (draft && draft.messages.length > 2) {
    restoreDraft(draft);
    return;
  }
  startSess();
}

// ── Config overlay ────────────────────────────────────────────────────────────
function openCfg() {
  document.getElementById('cfg-ant').value  = CREDS.anthropicKey;
  document.getElementById('cfg-gh').value   = CREDS.githubToken;
  document.getElementById('cfg-repo').value = CREDS.repo;
  document.getElementById('cfg-ov').classList.add('show');
  // Focus first empty field
  const ant = document.getElementById('cfg-ant');
  const gh  = document.getElementById('cfg-gh');
  setTimeout(() => (ant.value ? gh : ant).focus(), 80);
}

function closeCfg() {
  document.getElementById('cfg-ov').classList.remove('show');
}

function ocCfg(e) {
  if (e.target.id === 'cfg-ov') closeCfg();
}

function setCfgSt(type, txt) {
  const el = document.getElementById('cfg-st');
  el.className = `sh-st show ${type}`;
  el.textContent = txt;
}

function saveCfg() {
  const ant  = document.getElementById('cfg-ant').value.trim();
  const gh   = document.getElementById('cfg-gh').value.trim();
  const repo = document.getElementById('cfg-repo').value.trim();

  if (!ant || ant.length < 10) { setCfgSt('err', 'Anthropic key missing'); return; }
  if (!gh  || gh.length  < 10) { setCfgSt('err', 'GitHub token missing');  return; }

  localStorage.setItem('ar_ant',  ant);
  localStorage.setItem('ar_gh',   gh);
  localStorage.setItem('ar_repo', repo || 'mmraguin/miles-data');

  setCfgSt('ok', 'saved');
  setTimeout(() => {
    closeCfg();
    // If no session running yet, start one now
    if (S.messages.length === 0) {
      document.getElementById('chat').innerHTML = '';
      startSess();
    }
  }, 800);
}

function tvField(id, btn) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
  btn.textContent = el.type === 'password' ? 'show' : 'hide';
}

// ── iOS keyboard / viewport fix (index.html only) ────────────────────────────
if (document.getElementById('app')) {
  (function() {
    if (!window.visualViewport) return;

    function onViewportChange() {
      const vv    = window.visualViewport;
      const app   = document.getElementById('app');
      const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
                    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
      if (isIOS) {
        app.style.height   = vv.height + 'px';
        app.style.position = 'fixed';
        app.style.top      = vv.offsetTop + 'px';
        app.style.left     = vv.offsetLeft + 'px';
        app.style.width    = vv.width + 'px';
      } else {
        app.style.height = vv.height + 'px';
      }
      setTimeout(() => {
        const chat = document.getElementById('chat');
        if (chat) chat.scrollTop = chat.scrollHeight;
      }, 100);
    }

    window.visualViewport.addEventListener('resize', onViewportChange);
    window.visualViewport.addEventListener('scroll', onViewportChange);
  })();

  init();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function initDash() {
  const wmDate = document.getElementById('wm-date');
  if (wmDate) wmDate.textContent = todayManila();
  if (!credsReady()) { window.location.href = 'index.html'; return; }
  loadDash();
}

function dashRefresh() {
  try { localStorage.removeItem('ar_dash_cache'); } catch(e) {}
  loadDash();
}

// ── Dashboard: data fetching ──────────────────────────────────────────────────

async function fetchDashEntries(days) {
  const today = todayManila();
  const dates = Array.from({ length: days }, (_, i) => daysAgo(today, i + 1));
  const results = await Promise.allSettled(
    dates.map(date =>
      fetchEntry(`journal/daily/${date.slice(0,4)}/${date}.md`)
        .then(content => {
          if (!content) return null;
          const scores   = parseGraymatter(content);
          const booleans = parseDashBooleans(content);
          const dow      = new Date(date + 'T00:00:00Z').getUTCDay();
          return scores ? { date, scores, booleans, dow } : null;
        })
    )
  );
  return results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseDashBooleans(content) {
  if (!content || !content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};
  const yaml = content.slice(3, end);
  const gmIdx = yaml.indexOf('graymatter:');
  if (gmIdx === -1) return {};
  const gm = yaml.slice(gmIdx + 11);
  const result = {};
  for (const line of gm.split('\n')) {
    const m = line.match(/^\s{2}(medications|alcohol|wind_down):\s*(true|false)/);
    if (m) result[m[1]] = m[2] === 'true';
  }
  return result;
}

function parsePeopleProfile(content) {
  if (!content) return [];
  const people = [];
  const blocks = content.split(/\n  - name:/).slice(1);
  for (const block of blocks) {
    const name         = block.match(/^(.+)/)?.[1]?.trim();
    const relationship = block.match(/relationship:\s*(.+)/)?.[1]?.trim() || '';
    const type         = block.match(/\btype:\s*(.+)/)?.[1]?.trim() || 'regular';
    const sessions     = parseInt(block.match(/sessions_mentioned:\s*(\d+)/)?.[1] || '0', 10);
    const lastMention  = block.match(/last_mentioned:\s*(\d{4}-\d{2}-\d{2})/)?.[1] || null;
    const themesMatch  = block.match(/themes:\s*\[(.+?)\]/);
    const themes       = themesMatch ? themesMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')) : [];
    if (name) people.push({ name, relationship, type, sessions_mentioned: sessions, last_mentioned: lastMention, themes });
  }
  return people;
}

function parseEvolutionEntries(content) {
  if (!content) return [];
  const entries = [];
  const blocks = content.split(/\n## (\d{4}-\d{2}-\d{2})/).slice(1);
  for (let i = 0; i < blocks.length; i += 2) {
    const date = blocks[i];
    const body = blocks[i + 1] || '';
    const phaseMatch = body.match(/\*\*Phase:\s*(.+?)\*\*/);
    const phase = phaseMatch ? phaseMatch[1].trim() : '';
    const text = body.replace(/\*\*Phase:.*?\*\*/, '').trim();
    entries.push({ date, phase, text });
  }
  return entries;
}

// ── Dashboard: computations ───────────────────────────────────────────────────

function computeDashAverages(entries) {
  const sums = {}, counts = {};
  for (const { scores } of entries) {
    for (const [k, v] of Object.entries(scores)) {
      sums[k] = (sums[k] || 0) + v;
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  const avgs = {};
  for (const k of Object.keys(sums)) avgs[k] = Math.round((sums[k] / counts[k]) * 10) / 10;
  return avgs;
}

function computeSparkValues(entries, metric) {
  // Returns array of values (or null) for last N entries, oldest first
  return entries.map(e => e.scores[metric] ?? null);
}

function computeTrend(entries, metric) {
  const vals = entries.map(e => e.scores[metric]).filter(v => v != null);
  if (vals.length < 3) return '→';
  const half = Math.floor(vals.length / 2);
  const early = vals.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const late  = vals.slice(-half).reduce((a, b) => a + b, 0) / half;
  if (late - early > 0.4) return '↑';
  if (early - late > 0.4) return '↓';
  return '→';
}

function computeDayHeatmap(entries) {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sums = new Array(7).fill(0), counts = new Array(7).fill(0);
  for (const { dow, scores } of entries) {
    if (scores['Mood'] != null) { sums[dow] += scores['Mood']; counts[dow]++; }
  }
  return labels.map((label, i) => ({
    label,
    avg: counts[i] ? Math.round((sums[i] / counts[i]) * 10) / 10 : null,
    count: counts[i],
  }));
}

function computeCorrelations(entries) {
  const results = [];
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  function correlate(boolKey, nextMetric, label) {
    const pairs = sorted.slice(0, -1)
      .map((e, i) => ({ flag: !!e.booleans?.[boolKey], next: sorted[i + 1]?.scores?.[nextMetric] }))
      .filter(p => p.next != null);
    if (pairs.length < 4) return;
    const w  = pairs.filter(p => p.flag),  wo = pairs.filter(p => !p.flag);
    if (w.length < 2 || wo.length < 2) return;
    const avgW  = w.reduce((s, p) => s + p.next, 0) / w.length;
    const avgWo = wo.reduce((s, p) => s + p.next, 0) / wo.length;
    const delta = Math.round((avgW - avgWo) * 10) / 10;
    if (Math.abs(delta) >= 0.4) results.push({ label, delta, n: pairs.length });
  }

  correlate('alcohol',   'Energy',        'Alcohol → next-day energy');
  correlate('wind_down', 'Sleep Quality', 'Wind-down → next-day sleep');
  correlate('alcohol',   'Mood',          'Alcohol → next-day mood');
  return results;
}

function computeVelocity(person, today) {
  if ((person.sessions_mentioned || 0) < 3) return 'new';
  if (person.type === 'medical' || person.type === 'professional') return null;
  if (!person.last_mentioned) return 'quiet';
  const todayTs = new Date(today + 'T00:00:00Z').getTime();
  const lastTs  = new Date(person.last_mentioned + 'T00:00:00Z').getTime();
  const daysSince = (todayTs - lastTs) / 86400000;
  if (daysSince <= 14)  return 'rising';
  if (daysSince <= 90)  return 'quiet';
  return 'fading';
}

// ── Dashboard: SVG helpers ────────────────────────────────────────────────────

function makePentagonSvg(values, labels) {
  const cx = 110, cy = 110, r = 78;
  const n = values.length;
  const angles = Array.from({ length: n }, (_, i) => ((i * (360 / n)) - 90) * Math.PI / 180);

  const gridLines = [1, 2, 3, 4, 5].map(v => {
    const pts = angles.map(a => {
      const d = (v / 5) * r;
      return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`;
    });
    return `<polygon points="${pts.join(' ')}" fill="none" stroke="#1e1e1e" stroke-width="1"/>`;
  }).join('');

  const axisLines = angles.map(a =>
    `<line x1="${cx}" y1="${cy}" x2="${(cx + r * Math.cos(a)).toFixed(1)}" y2="${(cy + r * Math.sin(a)).toFixed(1)}" stroke="#1e1e1e" stroke-width="1"/>`
  ).join('');

  const dataPts = values.map((v, i) => {
    const d = ((v || 0) / 5) * r;
    return `${(cx + d * Math.cos(angles[i])).toFixed(1)},${(cy + d * Math.sin(angles[i])).toFixed(1)}`;
  });
  const dataPolygon = `<polygon points="${dataPts.join(' ')}" fill="rgba(78,205,180,0.15)" stroke="#4ecdb4" stroke-width="1.5"/>`;

  const labelEls = labels.map((lbl, i) => {
    const d = r + 22;
    const x = cx + d * Math.cos(angles[i]);
    const y = cy + d * Math.sin(angles[i]);
    const anchor = Math.cos(angles[i]) > 0.15 ? 'start' : Math.cos(angles[i]) < -0.15 ? 'end' : 'middle';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" fill="#575250" font-family="DM Mono,monospace" font-size="8" letter-spacing="1">${lbl.toUpperCase()}</text>`;
  }).join('');

  const valid = values.filter(v => v != null && v > 0);
  const avg = valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1) : '—';
  const centerEl = `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="#f0ece6" font-family="Fraunces,serif" font-size="20" font-style="italic">${avg}</text>`;

  return `<svg viewBox="0 0 220 220" width="100%" style="max-width:220px;display:block">${gridLines}${axisLines}${dataPolygon}${labelEls}${centerEl}</svg>`;
}

function makeSparklineSvg(values) {
  const w = 72, h = 20;
  const valid = values.filter(v => v != null);
  if (valid.length < 2) return '';
  const pts = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - 1) / 4) * (h - 4) - 2;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="metric-spark"><polyline points="${pts.join(' ')}" fill="none" stroke="#4ecdb4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// ── Dashboard: Haiku insights ─────────────────────────────────────────────────

async function callHaiku(systemPrompt, userMessage) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CREDS.anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `API error ${r.status}`); }
  const data = await r.json();
  if (!data.content?.[0]?.text) throw new Error('empty response');
  return data.content[0].text;
}

function parseDashInsights(text) {
  const KEYS = ['OVERVIEW', 'OBS1', 'OBS2', 'OBS3', 'MISSION1', 'MISSION2', 'MISSION3', 'BLIND_SPOT'];
  const sections = {};
  const keyAlt = KEYS.join('|');
  const re = new RegExp(`(${keyAlt}):([\\s\\S]*?)(?=(?:${keyAlt}):|$)`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    sections[m[1]] = m[2].trim().replace(/\s+/g, ' ');
  }
  return {
    overview:  sections['OVERVIEW'] || '',
    obs:       [sections['OBS1'], sections['OBS2'], sections['OBS3']].filter(Boolean),
    missions:  [sections['MISSION1'], sections['MISSION2'], sections['MISSION3']].filter(Boolean),
    blindSpot: sections['BLIND_SPOT'] || '',
  };
}

async function generateDashInsights(avgs, correlations, patternsContent, people, entryCount, lastDate) {
  if (entryCount < 3) return { overview: '', obs: [], missions: [], blindSpot: '' };

  const cacheKey = `${lastDate}_${entryCount}`;
  try {
    const cached = JSON.parse(localStorage.getItem('ar_dash_cache') || 'null');
    if (cached && cached.key === cacheKey) return cached.insights;
  } catch(e) {}

  const metricLine = (keys) => keys
    .filter(k => avgs[k] != null)
    .map(k => `${k}: ${avgs[k]}`)
    .join(' | ');

  const physical = metricLine(['Energy', 'Pain/Inflammation', 'Sleep Quality', 'Diet Adherence', 'Hydration']);
  const mental   = metricLine(['Mood', 'Anxiety', 'Motivation', 'Social Connection', 'Cognitive Clarity']);

  const corrLines = correlations.length
    ? correlations.map(c => `- ${c.label}: ${c.delta > 0 ? '+' : ''}${c.delta} (n=${c.n})`).join('\n')
    : 'None detected yet.';

  const patternsExcerpt = patternsContent ? patternsContent.slice(0, 500) : 'No patterns doc yet.';
  const peopleNames = people.filter(p => p.sessions_mentioned >= 3).map(p => `${p.name} (${p.relationship})`).join(', ') || 'None yet.';

  const systemPrompt = `You are Miles's personal intelligence system. Miles (she/her) lives in Manila with rheumatoid arthritis and POTS. You are looking at her last 14 days of health data.

Voice: Co-Star. Direct, second-person, slightly oracular. You talk to Miles, not about her.

Rules:
- Second-person throughout. "You've been…", "Your energy…", "You are…" — never "Miles has" or "the data shows"
- No hedging. No "it appears", "it may be", "it seems", "suggests"
- No academic framing. No "analysis indicates", "data suggests", "correlates with"
- No numbers, scores, entry counts, or record references
- Short, declarative sentences. Observe — don't explain.
- Never describe what happened. Name what it means.

CORRECT: "Rest isn't translating to recovery. Something is draining what sleep restores."
CORRECT: "You're treating social connection as optional. It isn't."
CORRECT: "You're managing the body. You're not addressing what's driving it."
WRONG: "Your energy score of 2 is critically low." — number, academic framing
WRONG: "Data suggests sleep quality is declining." — academic, third-person
WRONG: "This is not a bad day. This is a shutdown day." — dramatic, not observational

Avoid:
- Overworked adverbs: "quietly", "deeply", "fundamentally", "remarkably"
- AI vocabulary: "delve", "certainly", "leverage", "robust", "streamline", "harness", "tapestry", "landscape", "paradigm"
- Copula dodges: "serves as", "stands as", "marks", "represents" — just say "is"
- Negative parallelism: "It's not X. It's Y." — once max, never as a reflex
- Fake suspense: "Here's the thing", "Here's the kicker"
- Rhetorical questions you immediately answer: "The result? Devastating."
- Patronizing analogies: "Think of it as...", "It's like a..."
- Bullet-point logic dressed as sentences: "The first... The second... The third..."
- Signposted conclusions: "In conclusion", "To sum up"
- Tricolon pileups — one rule of three is fine, three in a row is a tell
- Em-dash overuse — use sparingly or not at all

Output exactly 8 lines. Each line starts with a label. No blank lines.

OVERVIEW: [One sentence. The structural dynamic of this period — not events or data. Speak directly to Miles.]
OBS1: [Metric name]: [What this reveals about your behavior or trajectory. Direct, second-person. No numbers.]
OBS2: [Metric name]: [The gap or contradiction this points to. What you're doing or not doing.]
OBS3: [Metric name]: [Same — meaning, not measurement. What it says about you right now.]
MISSION1: [Verb phrase. Specific, direct address. E.g.: "Track sleep within 30 minutes of waking."]
MISSION2: [Verb phrase. Specific.]
MISSION3: [Verb phrase. Specific.]
BLIND_SPOT: [One sentence. What you're consistently avoiding, not naming, or treating as fixed.]`;

  const userMessage = `${entryCount} entries logged in this period.

PHYSICAL (avg/5): ${physical}
MENTAL (avg/5): ${mental}

BEHAVIORAL CORRELATIONS:
${corrLines}

PATTERNS EXCERPT:
${patternsExcerpt}

PEOPLE MENTIONED (3+ sessions):
${peopleNames}`;

  try {
    const text = await callHaiku(systemPrompt, userMessage);
    const insights = parseDashInsights(text);
    try { localStorage.setItem('ar_dash_cache', JSON.stringify({ key: cacheKey, insights })); } catch(e) {}
    return insights;
  } catch(err) {
    return { overview: '', obs: [], missions: [], blindSpot: '' };
  }
}

// ── Dashboard: render ─────────────────────────────────────────────────────────

function renderDash(entries, people, patternsContent, evoEntries, insights) {
  const el = document.getElementById('dash-content');
  if (!el) return;

  const today = todayManila();
  const avgs  = computeDashAverages(entries);
  const heatmap = computeDayHeatmap(entries);
  const correlations = computeCorrelations(entries);

  const physMetrics = [
    { key: 'Energy',           label: 'Energy' },
    { key: 'Pain/Inflammation',label: 'Pain',   invert: true },
    { key: 'Sleep Quality',    label: 'Sleep' },
    { key: 'Diet Adherence',   label: 'Diet' },
    { key: 'Hydration',        label: 'Hydro' },
  ];
  const mentMetrics = [
    { key: 'Mood',              label: 'Mood' },
    { key: 'Anxiety',           label: 'Anxiety', invert: true },
    { key: 'Motivation',        label: 'Motiv' },
    { key: 'Social Connection', label: 'Social' },
    { key: 'Cognitive Clarity', label: 'Clarity' },
  ];

  // Pentagon values — inverted metrics: high pain/anxiety = low score visually
  const physVals = physMetrics.map(m => {
    const v = avgs[m.key];
    return v != null ? (m.invert ? parseFloat((6 - v).toFixed(1)) : v) : null;
  });
  const mentVals = mentMetrics.map(m => {
    const v = avgs[m.key];
    return v != null ? (m.invert ? parseFloat((6 - v).toFixed(1)) : v) : null;
  });

  function metricBarColor(val) {
    if (val == null) return '';
    if (val <= 2.0) return ' low';
    if (val <= 3.0) return ' mid';
    return '';
  }

  function metricRow(m) {
    const val    = avgs[m.key];
    const trend  = computeTrend(entries, m.key);
    const sparks = computeSparkValues(entries, m.key);
    const pct    = val != null ? Math.round((val / 5) * 100) : 0;
    const tClass = trend === '↑' ? 'up' : trend === '↓' ? 'down' : '';
    const dispVal = m.invert && val != null ? (6 - val).toFixed(1) : (val != null ? val : '—');
    return `<div class="metric-row">
      <div class="metric-name">${m.label}</div>
      <div class="metric-bar-wrap"><div class="metric-bar${metricBarColor(val)}" style="width:${pct}%"></div></div>
      <div class="metric-score">${dispVal}</div>
      <div class="metric-trend ${tClass}">${trend}</div>
      ${makeSparklineSvg(sparks)}
    </div>`;
  }

  // Date range label
  const firstDate = entries.length ? entries[0].date : null;
  const lastDate  = entries.length ? entries[entries.length - 1].date : null;
  const rangeLabel = firstDate && lastDate
    ? `${_fmtDate(firstDate)} — ${_fmtDate(lastDate)} · ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`
    : 'no entries found';

  // Almanac cells
  const almanacCells = heatmap.map(day => {
    const intensity = day.avg != null ? (day.avg - 1) / 4 : 0;
    const bg = day.avg != null
      ? `rgba(78,205,180,${(0.08 + intensity * 0.55).toFixed(2)})`
      : 'var(--surface)';
    return `<div class="almanac-day">
      <div class="almanac-label">${day.label}</div>
      <div class="almanac-cell" style="background:${bg}" title="${day.avg != null ? day.avg + '/5' : 'no data'}"></div>
      <div class="almanac-val">${day.avg != null ? day.avg : '—'}</div>
    </div>`;
  }).join('');

  // Correlations
  const corrHTML = correlations.length
    ? correlations.map(c => `<div class="corr-row">
        <div class="corr-label">${c.label}</div>
        <div class="corr-delta ${c.delta > 0 ? 'pos' : 'neg'}">${c.delta > 0 ? '+' : ''}${c.delta}</div>
        <div class="corr-n">n=${c.n}</div>
      </div>`).join('')
    : `<div class="dash-empty">More data needed to detect correlations.</div>`;

  // AI observations
  const obsHTML = insights.obs.length
    ? insights.obs.map(o => {
        const [label, ...rest] = o.split(':');
        return `<div class="obs-card">
          ${rest.length ? `<div class="obs-label">${label.trim()}</div><div class="obs-text">${rest.join(':').trim()}</div>` : `<div class="obs-text">${o}</div>`}
        </div>`;
      }).join('')
    : '';

  const blindSpotHTML = insights.blindSpot
    ? `<div class="obs-card" style="border-color:rgba(224,112,112,0.2)">
        <div class="obs-label" style="color:var(--error)">Blind Spot</div>
        <div class="obs-text">${insights.blindSpot}</div>
      </div>`
    : '';

  // Missions
  const missionsHTML = insights.missions.length
    ? insights.missions.map((m, i) => `<div class="mission-row">
        <div class="mission-num">${i + 1}</div>
        <div class="mission-text">${m}</div>
      </div>`).join('')
    : `<div class="dash-empty">Generating missions…</div>`;

  // People
  const visiblePeople = people
    .filter(p => p.sessions_mentioned >= 3)
    .sort((a, b) => (b.sessions_mentioned || 0) - (a.sessions_mentioned || 0));

  const peopleHTML = visiblePeople.length
    ? visiblePeople.map(p => {
        const velocity = computeVelocity(p, today);
        const initials = p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const lastSeen = p.last_mentioned ? _relativeDate(p.last_mentioned, today) : '';
        const velocityLabel = velocity === 'rising' ? 'Active' : velocity === 'fading' ? 'Fading' : velocity === 'quiet' ? 'Quiet' : velocity === 'new' ? 'New' : '';
        return `<div class="person-row">
          <div class="person-avatar">${initials}</div>
          <div class="person-info">
            <div class="person-name">${p.name}</div>
            <div class="person-rel">${p.relationship}${lastSeen ? ' · ' + lastSeen : ''}</div>
            ${p.themes.length ? `<div class="person-themes">${p.themes.slice(0, 4).map(t => `<span class="person-theme">${t}</span>`).join('')}</div>` : ''}
          </div>
          <div class="person-meta">
            ${velocityLabel ? `<div class="person-velocity ${velocity}">${velocityLabel}</div>` : ''}
            <div class="person-sessions">${p.sessions_mentioned} sessions</div>
          </div>
        </div>`;
      }).join('')
    : `<div class="dash-empty">People appear here after 3+ sessions.</div>`;

  // Evolution
  const lastEvoDate = evoEntries.length ? evoEntries[0].date : null;
  const evoHTML = evoEntries.length
    ? evoEntries.slice(0, 3).map(e => `<div class="evo-entry">
        <div class="evo-date">${e.date}</div>
        <div class="evo-phase">${e.phase || 'Untitled Phase'}</div>
        <div class="evo-body">${e.text.split('\n\n').slice(0, 2).join('\n\n')}</div>
      </div>`).join('')
    : `<div class="dash-empty">Evolution entries written every 3 months.</div>`;

  const sparseNote = entries.length < 7
    ? `<div class="dash-sparse-note">Reading sharpens with more data — ${7 - entries.length} more entr${7 - entries.length === 1 ? 'y' : 'ies'} to go.</div>`
    : '';

  el.innerHTML = `
    <div class="dash-range">${rangeLabel}</div>
    ${sparseNote}

    <div class="dash-section">
      ${insights.overview ? `<div class="dash-headline">"${insights.overview}"</div>` : ''}
    </div>

    <div class="dash-section">
      <div class="dash-section-label">Body + Mind · 14 days</div>
      <div class="dash-radars">
        <div class="radar-wrap">
          <div class="radar-label">Physical</div>
          ${makePentagonSvg(physVals, physMetrics.map(m => m.label))}
          <div class="radar-pill">avg ${physVals.filter(Boolean).length ? (physVals.filter(Boolean).reduce((a,b)=>a+b,0)/physVals.filter(Boolean).length).toFixed(1) : '—'}</div>
        </div>
        <div class="radar-wrap">
          <div class="radar-label">Mental</div>
          ${makePentagonSvg(mentVals, mentMetrics.map(m => m.label))}
          <div class="radar-pill">avg ${mentVals.filter(Boolean).length ? (mentVals.filter(Boolean).reduce((a,b)=>a+b,0)/mentVals.filter(Boolean).length).toFixed(1) : '—'}</div>
        </div>
      </div>
    </div>

    <div class="dash-section">
      <div class="dash-section-label">Scores</div>
      <div class="dash-groups">
        <div class="dash-group">
          <div class="dash-group-label">Physical</div>
          ${physMetrics.map(metricRow).join('')}
        </div>
        <div class="dash-group">
          <div class="dash-group-label">Mental</div>
          ${mentMetrics.map(metricRow).join('')}
        </div>
      </div>
    </div>

    <div class="dash-section">
      <div class="dash-section-label">Emotional Almanac · Mood by Day</div>
      <div class="almanac-grid">${almanacCells}</div>
    </div>

    <div class="dash-section">
      <div class="dash-section-label">Behavioral Correlations</div>
      ${corrHTML}
    </div>

    <div class="dash-section">
      <div class="dash-section-label">What the System Noticed</div>
      ${obsHTML}
      ${blindSpotHTML}
    </div>

    <div class="dash-section">
      <div class="dash-section-label">Missions</div>
      ${missionsHTML}
    </div>

    <div class="dash-section">
      <div class="dash-section-label">Inner Circle</div>
      <div class="people-grid">${peopleHTML}</div>
    </div>

    <div class="dash-section">
      <div class="dash-section-label">Evolution${lastEvoDate ? `<span class="dash-section-meta">last entry ${lastEvoDate}</span>` : ''}</div>
      ${evoHTML}
    </div>
  `;
}

// ── Dashboard: helpers ────────────────────────────────────────────────────────

function _fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

function _relativeDate(dateStr, today) {
  const d1 = new Date(dateStr + 'T00:00:00Z').getTime();
  const d2 = new Date(today  + 'T00:00:00Z').getTime();
  const days = Math.round((d2 - d1) / 86400000);
  if (days === 0)  return 'today';
  if (days === 1)  return 'yesterday';
  if (days < 7)   return `${days}d ago`;
  if (days < 30)  return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

// ── Dashboard: orchestrate ────────────────────────────────────────────────────

async function loadDash() {
  const el = document.getElementById('dash-content');
  if (!el) return;
  el.innerHTML = '<div class="dash-loading">reading your archive…</div>';

  try {
    const [entries, patternsContent, peopleContent, evolutionContent] = await Promise.all([
      fetchDashEntries(14),
      fetchEntry('notes/patterns.md'),
      fetchEntry('notes/people-profile.md'),
      fetchEntry('notes/evolution.md'),
    ]);

    const people     = parsePeopleProfile(peopleContent);
    const evoEntries = parseEvolutionEntries(evolutionContent);
    const avgs       = computeDashAverages(entries);
    const correlations = computeCorrelations(entries);
    const lastDate   = entries.length ? entries[entries.length - 1].date : todayManila();

    // Render structure immediately with computed data, then fill in AI insights
    const insights = await generateDashInsights(avgs, correlations, patternsContent, people, entries.length, lastDate);
    renderDash(entries, people, patternsContent, evoEntries, insights);
  } catch(err) {
    if (el) el.innerHTML = `<div class="dash-loading">could not load — ${err.message}</div>`;
  }
}
