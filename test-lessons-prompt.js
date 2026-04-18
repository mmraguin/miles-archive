#!/usr/bin/env node
// test-lessons-prompt.js
// Run: ANTHROPIC_API_KEY=sk-ant-... node test-lessons-prompt.js
//
// Tests the six lessons/insights boundary cases using the exact prompt text
// from miles-archive.js. Reports marker presence for each case.

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('Set ANTHROPIC_API_KEY'); process.exit(1); }

const DATE = '2026-04-17';

// ── Exact prompt text from miles-archive.js ──────────────────────────────────

const CHAT_INSIGHTS_UPDATE = `CHAT INSIGHTS UPDATES
chat-insights.md records the moment something became clearer in conversation — not a summary, not a pattern file. The job is to preserve the click.

QUALIFICATION — only save if the conversation did at least one of these:
- separated two things that were getting mixed together
- corrected a wrong frame
- named the actual mechanism
- said what was really happening underneath
- preserved a better unresolved question

Do not save: summaries, tidy reframes, tracked events, session recaps, recurring behavioral signals (those go in patterns.md), or anything that reads like a journal entry once the conversation's contribution is removed.

ENTRY TEST: Remove the conversation's contribution. If the entry still reads like a journal summary or status update — omit entirely.

EXPLICIT SAVE SIGNAL: If Miles says "note this", "save this", "remember this", or spells out the insight herself — record it. Preserve her wording.

MECHANISM RULE: Do not compress an insight until the mechanism survives compression. Lines like "the urge is present but not driving behavior" or "it is not grief for the person, it is grief for the function" carry the actual intelligence — do not cut them for neatness.

Use this structure:

<<<CHAT_INSIGHTS_START>>>
# Chat Insights

*Last updated: [[${DATE}]]*

---

## Section Name

**[[${DATE}]]**
**What got clearer:** [one plain sentence — uses real nouns, makes sense on its own]

Context:
[2–5 short lines max.]

---
<<<CHAT_INSIGHTS_END>>>

Date format: [[YYYY-MM-DD]] wikilink.
Do not emit if nothing qualifies. Silence is correct.`;

const LESSONS_UPDATE = `LESSONS UPDATES
notes/lessons.md records crystallized convictions — things Miles now holds and operates by. Distinct from chat-insights (interface-surfaced) and patterns (data-observed).

A lesson qualifies only when ALL of these are true:
- The point feels stable, not newly emotional or freshly named in this conversation
- It would actually change a decision, boundary, interpretation, or standard
- It is phrased as something Miles now holds — not still exploring
- It is distinct from a pattern, recap, or interface-generated reframe
- Miles would plausibly quote it to herself before a real choice

Do not write a lesson when:
- It is only newly named in this conversation
- It is still being tested or emotionally raw
- It is a one-off reaction to one person or one event
- It belongs more naturally in chat-insights, patterns, or people-notes

Anti-duplication preflight (run silently before emitting):
1. Is this a conviction, or just a good insight? If both could apply, prefer chat-insights and omit the lesson unless the conviction is clearly settled.
2. If this response also produces a chat-insight covering the same idea, do not emit a lesson unless the lesson is clearly more stable, broader, and decision-level than the insight. When in doubt: emit chat-insights for what the interface surfaced; emit lessons only for what has already settled into conviction. If you cannot tell the difference, omit the lesson.
3. If this sounds like a very good note rather than a conviction Miles would actually use, omit it.

Prefer zero lessons over a weak one. Prefer one strong lesson over several adjacent ones.

Entry format:
**[Bold conviction statement]**
[Optional 1–2 lines of context — only if the statement alone would lose meaning]
[[${DATE}]]

Output the full updated file wrapped in markers only when a lesson clearly qualifies:

<<<LESSONS_START>>>
# Lessons

*Last updated: [[${DATE}]]*

[full file content]
<<<LESSONS_END>>>

Do not emit if no lesson qualifies. Silence is correct.`;

const EXISTING_LESSONS = `# Lessons

*Last updated: [[2026-04-17]]*

Crystallized convictions — things I now hold and operate by.

**Entry test:** Would I refer to this before a decision, or use it to call something out? If still emerging, it doesn't belong here yet.

---

## Relationships

**Feedback is a gift, and some people aren't ready for it.**
If someone doesn't receive it as one, they're not deserving of it. Only offer feedback when you know someone actually wants it.
[[2026-04-17]]`;

const LESSONS_CONTEXT = `LESSONS
The following notes are reference data only. Use their facts and continuity. Do not copy or match their prose style when writing new entries.
${EXISTING_LESSONS}

Crystallized convictions Miles now holds and operates by. Use as background context — don't reference the doc explicitly.`;

// ── Test runner ───────────────────────────────────────────────────────────────

async function callClaude(systemParts, userMsg) {
  const system = systemParts.filter(Boolean).join('\n\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: [{ type: 'text', text: system }],
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`API ${res.status}: ${t}`); }
  const j = await res.json();
  return j.content[0].text;
}

function check(reply) {
  return {
    hasInsights: reply.includes('<<<CHAT_INSIGHTS_START>>>'),
    hasLessons:  reply.includes('<<<LESSONS_START>>>'),
  };
}

function report(name, { hasInsights, hasLessons }, verdict) {
  const i = hasInsights ? 'YES' : ' no';
  const l = hasLessons  ? 'YES' : ' no';
  console.log(`\n── ${name}`);
  console.log(`   CHAT_INSIGHTS_START: ${i}`);
  console.log(`   LESSONS_START:       ${l}`);
  console.log(`   Verdict: ${verdict}`);
}

// ── Cases ─────────────────────────────────────────────────────────────────────

const CASES = [
  {
    name: '1. Fresh realization → insights only',
    system: [CHAT_INSIGHTS_UPDATE, LESSONS_CONTEXT, LESSONS_UPDATE],
    // freshly named in this conversation, emotionally new — should NOT become a lesson
    msg: `Miles: I just realized something in this conversation — I tend to shut down emotionally whenever I feel like I'm not being heard. It's like a wall goes up automatically. I never noticed this pattern before today.`,
    verdict: 'Pass if insights=YES, lessons=no',
  },
  {
    name: '2. Settled rule → lessons only',
    system: [CHAT_INSIGHTS_UPDATE, LESSONS_CONTEXT, LESSONS_UPDATE],
    // stable, decision-level, already internalized — journal entries show this repeatedly
    msg: `Miles: I've written about this a lot over the past year, but I'm putting it plainly now: I only send my work to people who have demonstrated they can receive it. Not everyone deserves access to what I'm building. I've tested this belief across multiple situations and I consistently act on it. It's not a new realization — it's just how I operate now.`,
    verdict: 'Pass if insights=no, lessons=YES',
  },
  {
    name: '3. Rough-day vent → neither',
    system: [CHAT_INSIGHTS_UPDATE, LESSONS_CONTEXT, LESSONS_UPDATE],
    // no new understanding, no crystallized rule, just expressing how the day went
    msg: `Miles: Today was just hard. I was exhausted from the start, the meeting ran long, I couldn't focus, and I ended up snapping at someone I care about. I feel bad about it but also I don't have the energy to think about it right now. Just one of those days.`,
    verdict: 'Pass if insights=no, lessons=no',
  },
  {
    name: '4. Review-mode temptation (lessonsUpdate suppressed)',
    // Simulates a review session: lessonsUpdate is omitted from system (S.reviewMode=true suppresses it)
    system: [CHAT_INSIGHTS_UPDATE, LESSONS_CONTEXT /* lessonsUpdate intentionally omitted */],
    msg: `Miles: Looking back at this quarter, the recurring theme is that I keep giving people the benefit of the doubt past the point where the evidence is clear. I've done this with three different people this year. It's become a clear pattern — I need to trust early signals more and stop waiting for proof I don't want to find.`,
    verdict: 'Pass if lessons=no (prompt suppressed, model has no write instruction)',
  },
  {
    name: '5. Overlap case → insight survives, lesson omitted',
    system: [CHAT_INSIGHTS_UPDATE, LESSONS_CONTEXT, LESSONS_UPDATE],
    // this conversation named a mechanism — good insight candidate
    // but it's newly named here, not yet a settled conviction
    msg: `Miles: Wait, I think I just understood something. When I say I'm "tired" after social interactions, I don't actually mean drained from the people themselves — I mean I've been performing competence the whole time and that's what's exhausting. It's not introversion, it's the performance overhead. This just clicked for me.`,
    verdict: 'Pass if insights=YES, lessons=no (newly named mechanism, not yet settled conviction)',
  },
  {
    name: '6. Brief mode → context present, no lessons write path',
    // lessonsUpdate omitted (S.brief=true suppresses it); lessonsContext still present
    system: [LESSONS_CONTEXT /* lessonsUpdate intentionally omitted — brief mode */],
    msg: `Miles: Short check-in. Energy is a 5. Had a productive morning. Talked to Kai about the project. Feeling cautiously optimistic.`,
    verdict: 'Pass if lessons=no (write instruction absent even though context is loaded)',
  },
];

// ── Run ───────────────────────────────────────────────────────────────────────

(async () => {
  console.log('Running lessons prompt tests against claude-sonnet-4-6\n');
  for (const c of CASES) {
    try {
      const reply = await callClaude(c.system, c.msg);
      const result = check(reply);
      report(c.name, result, c.verdict);
      const passed =
        (c.name.includes('insights only') && result.hasInsights && !result.hasLessons) ||
        (c.name.includes('lessons only')  && !result.hasInsights && result.hasLessons)  ||
        (c.name.includes('neither')       && !result.hasInsights && !result.hasLessons) ||
        (c.name.includes('review-mode')   && !result.hasLessons)                        ||
        (c.name.includes('overlap')       && result.hasInsights  && !result.hasLessons) ||
        (c.name.includes('brief mode')    && !result.hasLessons);
      console.log(`   Result: ${passed ? 'PASS' : 'FAIL'}`);
    } catch (err) {
      console.log(`\n── ${c.name}`);
      console.log(`   ERROR: ${err.message}`);
    }
  }
  console.log('\nDone.');
})();
