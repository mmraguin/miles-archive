// ── Credentials ───────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = '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';
const GITHUB_TOKEN  = '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';
const GITHUB_REPO   = 'mmraguin/miles-archive';

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  messages:     [],
  sessionDate:  null,
  sessionDow:   null,
  sessionDay:   null,
  brief:        false,
  thinking:     false,
  pendingEntry: null,
  pendingPath:  null,
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
    daily:          `journal/daily/${date}.md`,
    weekly:         `journal/weekly/${isoWeek(date)}.md`,
    monthly:        `journal/monthly/${date.slice(0,7)}.md`,
    psychiatrist:   `summaries/psychiatrist/${date}.md`,
    rheumatologist: `summaries/rheumatologist/${date}.md`,
    goals:          `goals/current.md`,
  }[type] || `journal/daily/${date}.md`;
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
  if (msg.includes('401'))          return 'API key invalid — check credentials';
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
  const identity = `You are Miles's personal intelligence system — journal interviewer, pattern tracker, honest observer. You conduct daily journal interviews, notice what matters, and produce structured markdown entries.`;

  // ── Section: Context
  const context = `TODAY: ${dow}, ${date} (GMT+8, Manila).`;

  // ── Section: Health
  const health = `HEALTH CONTEXT (carry always)
- IgA vasculitis (active) — ESR 76 Jan 2026, rising linearly 2+ years, not well-controlled
- MDD, anxiety, panic disorder, agoraphobia
- Recurrent syncope, last episode Nov 2025
- Chronic normocytic anemia; Vitamin D deficiency (persistent despite 5000 IU)
- 14 nights avg SpO2 below 90% — no sleep study yet
- LDL 3.97 (Jan 2025), not rechecked; iron studies absent from record`;

  // ── Section: Medications
  const meds = `MEDICATIONS
- Azathioprine 50mg BD, Colchicine 0.5mg BD
- Methotrexate 7.5mg weekly (Saturdays), Folic acid 5mg weekly (Sundays)
- Sertraline 50mg daily, Hydroxyzine 25mg PRN
- Omega-3, Vitamin D 5000 IU
${d === 6 ? '→ SATURDAY: confirm Methotrexate taken naturally mid-conversation.\n' : ''}${d === 0 ? '→ SUNDAY: confirm Folic acid taken naturally mid-conversation.\n' : ''}`;

  // ── Section: Coaching posture
  const coaching = `COACHING POSTURE
Read Miles's energy at the start of each session and adapt accordingly. Do not announce the mode.

- LOW ENERGY / TIRED / BRIEF: Mindful Observer. Quieter, more space, minimal follow-ups. Let him lead.
- PROCESSING SOMETHING DIFFICULT: Nurturing Catalyst first — acknowledge, make space. If he seems to want clarity, shift to Socratic Guide — one question at a time, let him arrive at his own understanding.
- REPEATING PATTERN OR STUCK LOOP: Direct Truth-Teller. Name what you see plainly. "This is the third time you've described this ending the same way."
- RATIONALIZING / INCONSISTENT: Strategic Provocateur. Gentle opposition. "What would you say to someone else in this situation?" Test the story.
- REFLECTING / PHILOSOPHICAL: Socratic Guide. Follow the thread, don't resolve prematurely.

TRUTH OVER COMFORT
- If the narrative and the numbers diverge, name it.
- If something has appeared multiple times in this session, surface it — don't let it pass.
- Do not validate stories that aren't serving him.
- Do not pathologize ordinary bad days. There is a difference between a hard day and a pattern.
- Clinical observations (pain, energy, inflammation) should be noted plainly, not softened.`;

  // ── Section: Brief mode
  const briefMode = S.brief ? `\nBRIEF MODE ACTIVE: 2–3 exchanges max before moving to numbers. Skip extended follow-ups. Match his energy — keep it short.\n` : '';

  // ── Section: Graymatter
  const graymatter = `GRAYMATTER FIELDS
Physical (1–5): Energy, Pain/Inflammation, Sleep Quality, Diet Adherence, Hydration
Mental/Emotional (1–5): Mood, Anxiety, Motivation, Social Connection, Cognitive Clarity
Behavioral (yes/no): Medications, Alcohol, Wind-down
Flags (only if mentioned): Panic attack, Near-syncope, Skin changes/purpura, GI symptoms`;

  // ── Section: Daily protocol
  const protocol = `DAILY JOURNAL PROTOCOL
1. OPEN: Use one of the session openers below. Fresh session only — do not re-open if context already exists.
2. Let Miles give the overview freely. Do not rush.
3. Reporter mode: one follow-up at a time. Follow threads — do not interrogate.
4. Apply coaching posture as the session develops. Observations and pushback are welcome when earned.
5. Transition to numbers when the narrative feels complete: "Okay — let's do the numbers."
6. Collect all graymatter fields. Weave context from the day naturally into the narrative.
7. When everything is collected, produce the formatted entry.

SESSION OPENERS (rotate — use one, vary across sessions, read the hour and energy):
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
When the interview is complete, output the entry wrapped in markers. Everything between the markers is saved to GitHub — make it clean.

<<<ENTRY_START>>>
# Daily Journal — ${dow}, ${date}

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

## Garmin
[Only if data was provided. Omit otherwise.]

## Notes
[Notability content or stray thoughts. Omit if none.]
<<<ENTRY_END>>>

For weekly/monthly reviews and clinical summaries: use appropriate format, same markers, state type clearly at the top.`;

  // ── Section: Language + notability
  const misc = `LANGUAGE: Follow Miles — English, Tagalog, French. Switch naturally mid-conversation without comment.
NOTABILITY: When Miles pastes raw OCR text, clean it preserving his voice exactly. Ask where it goes if unclear.`;

  return [identity, context, health, meds, coaching, briefMode, graymatter, protocol, output, misc]
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
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
      { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' } }
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

// ── Entry extraction ──────────────────────────────────────────────────────────
function extractEntry(txt) {
  const s = txt.indexOf('<<<ENTRY_START>>>');
  const e = txt.indexOf('<<<ENTRY_END>>>');
  if (s === -1 || e === -1) return null;
  return txt.slice(s + 17, e).trim();
}

function detectType(txt) {
  if (/psychiatrist/i.test(txt))   return 'psychiatrist';
  if (/rheumatologist/i.test(txt)) return 'rheumatologist';
  if (/weekly review/i.test(txt))  return 'weekly';
  if (/monthly review/i.test(txt)) return 'monthly';
  if (/goals/i.test(txt))          return 'goals';
  return 'daily';
}

// ── GitHub save ───────────────────────────────────────────────────────────────
async function getSHA(path) {
  const r = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' } }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`SHA check failed ${r.status}`);
  return (await r.json()).sha;
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
    const sha  = await getSHA(S.pendingPath);
    const enc  = b64Encode(S.pendingEntry);
    const body = {
      message: `journal: ${S.pendingPath.split('/').pop().replace('.md', '')}`,
      content: enc,
    };
    if (sha) body.sha = sha;
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${S.pendingPath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) { const e = await r.json(); throw new Error(e.message || `error ${r.status}`); }
    setSaveSt('ok', 'saved');
    addSys(`saved → ${S.pendingPath}`);
    S.pendingEntry = null; S.pendingPath = null;
    try { localStorage.removeItem('ar_drafts'); } catch(e) {}
    setTimeout(() => {
      document.getElementById('save-bar').classList.remove('show');
      document.getElementById('save-st').className = '';
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
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
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
    const entry = extractEntry(reply);
    const disp  = entry
      ? (reply.slice(0, reply.indexOf('<<<ENTRY_START>>>')).trim() || 'Entry ready.')
      : reply;
    addMsg('assistant', disp);
    S.messages.push({ role: 'assistant', content: reply });
    saveDraft();
    if (entry) showSaveBar(entry, detectType(reply));
    setStat('ready', `ready — ${S.sessionDate}`);
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
  S.messages = []; S.pendingEntry = null; S.pendingPath = null; S.brief = false;
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

// ── Start session ─────────────────────────────────────────────────────────────
async function startSess() {
  setStat('thinking', '…');
  S.thinking = true;
  document.getElementById('send-btn').disabled = true;
  showDots();

  // Pass hour context so Claude can pick a time-appropriate opener
  const h = hourManila();
  const timeHint = h < 8 ? 'early morning' : h >= 22 ? 'late night' : h >= 18 ? 'evening' : 'daytime';

  try {
    const opening = [{
      role: 'user',
      content: `Start the journal session. It is ${timeHint} in Manila.`,
    }];
    const reply = await callClaude(opening);
    hideDots();
    addMsg('assistant', reply);
    S.messages = [
      { role: 'user', content: `Start the journal session. It is ${timeHint} in Manila.` },
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
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  _initSessionMeta();

  const draft = loadDraft();
  if (draft && draft.messages.length > 2) {
    restoreDraft(draft);
    return;
  }
  startSess();
}

// ── iOS keyboard fix ──────────────────────────────────────────────────────────
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    document.getElementById('app').style.height = window.visualViewport.height + 'px';
  });
}

init();
