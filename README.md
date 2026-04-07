# miles-archive

Personal journal and intelligence system. One daily conversation with Claude that captures the day, tracks health data, and saves structured markdown to a private GitHub repo.

Chat: `https://mmraguin.github.io/miles-archive/`
Dashboard: `https://mmraguin.github.io/miles-archive/dashboard.html`

---

## What It Is

Two-page web app on GitHub Pages. Vanilla HTML/CSS/JS, no build step. Uses the Anthropic API directly from the browser and the GitHub API for storage.

**Two-repo architecture:** App code lives in this public repo (`mmraguin/miles-archive`). All journal data, notes, and goals live in a separate private repo, configured via `ar_repo` in localStorage.

---

## Stack

| Layer | Detail |
|---|---|
| Hosting | GitHub Pages — public repo, app code only |
| Data | Private repo (configured via `ar_repo` in localStorage) |
| Frontend | Vanilla HTML/CSS/JS — no frameworks, no build step |
| AI | Anthropic API, `claude-sonnet-4-6` |
| Storage | GitHub API (entries + notes), localStorage (credentials + drafts) |
| Fonts | Fraunces (display serif) + DM Sans (body) + DM Mono (mono) |
| Accent | Teal `#4ecdb4` on near-black `#0a0a0a` |

---

## Self-Hosting

1. Fork this repo and enable GitHub Pages (root, main branch)
2. Create a second private repo for data
3. Open the app, tap ⚙, and set:
   - **Anthropic key** (`ar_ant`) — from console.anthropic.com
   - **GitHub PAT** (`ar_gh`) — classic token, `repo` scope
   - **Data repo** (`ar_repo`) — `owner/repo-name`

All credentials stay in `localStorage` on your device — nothing is sent to any server other than Anthropic and GitHub directly.

> Anthropic auto-revokes API keys found in chat or public repos — never paste your key into the chat UI.

---

## Reference

- [CLAUDE.md](CLAUDE.md) — implementation context for development and Claude Code
- [ROADMAP.md](ROADMAP.md) — feature status and planned work
