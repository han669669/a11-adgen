# Decisions log

Each line: the decision, the date (SGT), who, why. Newest last. A later decision replaces an earlier one; keep both lines.

| Date | Decision | Who | Why |
|---|---|---|---|
| 2026-11-06 | Rebuild the ad tool as a new repo, `a11-adgen`, instead of changing `ai-ad-generator`. | han | Two goals (section 2 of `AGENTS.md`). v1 Use rate fell to 14%. |
| 2026-11-06 | Stack: Vite + React + shadcn/ui + Fluid Functionalism; email + password allow-list auth; Cloudflare for all backend; Exa; fal.ai GPT Image 2.5 Sunburst (low drafts, high finals); 4:5. No Convex. | han | Owner's stack choice. |
| 2026-11-06 | Claude Code (owner's subscription) is the only brain, through a custom remote MCP server. TheGrid is dropped. | han | Strongest model at no per-token cost. |
| 2026-11-06 | One human step only: the owner picks which drafts get the final high render. Claude picks ideas and ranks drafts. | han | "the less attention u need from a human the better". |
| 2026-11-06 | No Meta ad account access. Results come from client screenshots or CSV exports. | han | a11 does not manage client campaigns. |
| 2026-11-06 | Private GitHub repo `han669669/a11-adgen`. | han | |
| 2026-11-06 | Port v1 marks, notes and Used ads when useful. | han | Seeds the canon, swipe file and gold set. |
| 2026-11-06 | App URL `a11adgen.gamingcomputing.workers.dev` (account subdomain `gamingcomputing`, unchanged). | han (subdomain detail: agent) | Owner asked for the workers.dev subdomain; a bare `a11-adgen.workers.dev` is not possible. |
| 2026-11-06 | Secrets: the owner sets them as Worker secrets when the agent asks, never in chat. | han | |
| 2026-11-06 | Worker name `a11adgen` (no hyphen), so the URL is `a11adgen.gamingcomputing.workers.dev`. Other resources: D1 `a11adgen-db`, R2 `a11adgen-media`. Repo name stays `a11-adgen`. | han | Replaces the URL line above. |
| 2026-11-06 | Stay on the Cloudflare Workers Free plan. | han | Design for its limits (`AGENTS.md` §6). |
| 2026-11-06 | No Cloudflare API token; deploy through the Cloudflare connector. MCP server hand-written (14 KB) instead of the Agents SDK + MCP SDK (1.2 MB). | han (no token), agent (hand-written server) | The connector upload needs a small bundle; a small bundle also starts fast under the 10 ms CPU limit. |
| 2026-11-06 | Phase 0 `/mcp` auth: bearer token, only its SHA-256 stored on the Worker. OAuth in Phase 1. | agent | The token never passes through a deploy call or the repo. |
