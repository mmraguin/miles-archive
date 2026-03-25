// ── Credentials (localStorage — never hardcoded) ─────────────────────────────
const CREDS = {
  get anthropicKey() { return localStorage.getItem('ar_ant')  || ''; },
  get githubToken()  { return localStorage.getItem('ar_gh')   || ''; },
  get repo()         { return localStorage.getItem('ar_repo') || 'mmraguin/miles-archive'; },
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
  patterns:         null,  // fetched from notes/patterns.md
  pendingPatterns:  null,  // patterns doc update pending save
  deepFetched:      false, // whether deep context fetch has fired this session
  _queuedPatterns:  null,  // patterns update queued to show after entry bar clears
};

// ── Date helpers ──────────────────────────────────────────────────────────────
function todayManila() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function dowManila() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', weekday: 'long',
  }).format(new Date());
}

function dayIndexManila() {
  const abbr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', weekday: 'short',
  }).format(new Date());
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

  // ── Section: Language + notability
  const misc = `LANGUAGE: Follow Miles — English, Tagalog, French. Switch naturally mid-conversation without comment.
NOTABILITY: When Miles pastes raw OCR text, clean it preserving her voice exactly. Ask where it goes if unclear.`;

  return [identity, context, stateDoc, goalsContext, patternsContext, recentContext, graymatterTrend, trendAwareness, fetchDeep, coaching, briefMode, graymatter, protocol, output, voice, stateUpdate, patternsUpdate, misc]
    .filter(Boolean)
    .join('\n\n');
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
    }, 2400);
  } catch(err) {
    setPatSt('err', friendlyError(err));
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
async function callClaude(messages, retrying = false) {
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
        system:     buildSysPrompt(),
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
      return callClaude(messages, true);
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
    const entry    = extractEntry(reply);
    const state    = extractState(reply);
    const patterns = extractPatterns(reply);
    const deepFetch = reply.includes('<<<FETCH_DEEP>>>');
    // Strip all markers from displayed text
    let disp = reply;
    if (entry)    disp = disp.slice(0, disp.indexOf('<<<ENTRY_START>>>')).trim() || 'Entry ready.';
    if (state)    disp = disp.replace(/<<<STATE_START>>>[\s\S]*?<<<STATE_END>>>/g, '').trim();
    if (patterns) disp = disp.replace(/<<<PATTERNS_START>>>[\s\S]*?<<<PATTERNS_END>>>/g, '').trim();
    disp = disp.replace(/<<<FETCH_DEEP>>>/g, '').trim();
    addMsg('assistant', disp || 'Done.');
    S.messages.push({ role: 'assistant', content: reply });
    saveDraft();
    if (state) showStateBar(state);
    // Queue patterns after entry bar, or show immediately if no entry
    if (patterns && entry) {
      S._queuedPatterns = patterns;
    } else if (patterns) {
      showPatBar(patterns);
    }
    if (entry) showSaveBar(entry, detectType(reply));
    setStat('ready', `ready — ${S.sessionDate}`);
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
  S.deepFetched = false; S._queuedPatterns = null;
  document.getElementById('pat-bar').classList.remove('show');
  document.getElementById('pat-st').className = '';
  document.getElementById('state-bar').classList.remove('show');
  document.getElementById('state-st').className = '';
  document.getElementById('brief-btn').classList.remove('on');
  document.getElementById('chat').innerHTML = '';
  document.getElementById('save-bar').classList.remove('show');
  document.getElementById('save-st').className = '';
  document.getElementById('save-go').disabled = false;
  _initSessionMeta();
  startSess();
}

function _initSessionMeta() {
  S.sessionDate = todayManila();
  S.sessionDow  = dowManila();
  S.sessionDay  = dayIndexManila();
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

function fetchGoals()    { return fetchEntry('notes/goals-summary.md'); }
function fetchPatterns() { return fetchEntry('notes/patterns.md'); }

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
  const [recentEntries, stateOfMiles, goals, patterns] = await Promise.all([
    fetchRecentEntries(),
    fetchStateOfMiles(),
    fetchGoals(),
    fetchPatterns(),
  ]);
  S.recentEntries = recentEntries;
  S.stateOfMiles  = stateOfMiles;
  S.goals         = goals;
  S.patterns      = patterns;
}

// ── Start session ─────────────────────────────────────────────────────────────
async function startSess() {
  setStat('thinking', '…');
  S.thinking = true;
  document.getElementById('send-btn').disabled = true;
  showDots();

  const h = hourManila();
  const timeHint = h < 8 ? 'early morning' : h >= 22 ? 'late night' : h >= 18 ? 'evening' : 'daytime';

  // Fetch today's entry + recent days + state doc + goals + patterns in parallel
  const [existing, recentEntries, stateOfMiles, goals, patterns] = await Promise.all([
    fetchTodayEntry(),
    fetchRecentEntries(),
    fetchStateOfMiles(),
    fetchGoals(),
    fetchPatterns(),
  ]);
  S.existingEntry = existing;
  S.recentEntries = recentEntries;
  S.stateOfMiles  = stateOfMiles;
  S.goals         = goals;
  S.patterns      = patterns;

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
  localStorage.setItem('ar_repo', repo || 'mmraguin/miles-archive');

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

// ── iOS keyboard / viewport fix ──────────────────────────────────────────────
(function() {
  if (!window.visualViewport) return;

  function onViewportChange() {
    const vv     = window.visualViewport;
    const app    = document.getElementById('app');
    const isIOS  = /iP(hone|ad|od)/.test(navigator.userAgent) ||
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIOS) {
      // Pin app to the visual viewport — keeps input above keyboard
      app.style.height    = vv.height + 'px';
      app.style.position  = 'fixed';
      app.style.top       = vv.offsetTop + 'px';
      app.style.left      = vv.offsetLeft + 'px';
      app.style.width     = vv.width + 'px';
    } else {
      app.style.height = vv.height + 'px';
    }

    // Scroll chat to bottom after keyboard animation settles
    setTimeout(() => {
      const chat = document.getElementById('chat');
      chat.scrollTop = chat.scrollHeight;
    }, 100);
  }

  window.visualViewport.addEventListener('resize', onViewportChange);
  window.visualViewport.addEventListener('scroll', onViewportChange);
})();

init();
