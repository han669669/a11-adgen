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
| 2026-11-06 | D1 `a11adgen-db` and R2 `a11adgen-assets` live in Asia Pacific (`apac`). Both were recreated (a location is fixed at creation). R2 got a new name: re-creating `a11adgen-media` kept its old ENAM location. | han | Data near Singapore. |
| 2026-11-07 | Final renders use the chosen draft (and the logo) as references, not the original pack photo, when the scene changes the product's state. | agent (Phase 0 evidence) | The pack photo's full jar and lid overrode the draft at high quality (`docs/phase0-results.md` §3). |
| 2026-11-07 | Media route `/m/` answers HEAD as well as GET. | agent | fal checks reference URLs with HEAD. |
| 2026-11-07 | cubic is the repo's code reviewer: check each finding against the code, fix the real ones, reply on every thread and resolve it. v1's "ignore cubic" rule does not apply here. | han | "cubic's opinions matters" |
| 2026-11-07 | Proposed, not yet approved: logo by construction. The model leaves the logo area as plain backdrop; code draws the real logo file with the Cloudflare Images binding (`.draw()`). | agent, from han's mark on the Phase 0 ad | The painted WonGi logo did not match the real wordmark (no star in the "o", other letter shapes). The Images binding works on the Free plan (tested 2026-11-07). v1's paste (#196) failed as a lighter box on a gradient; here the logo goes on a plain area the model left empty. Needs han's yes because it reverses v1 #196. |
| 2026-11-07 | Logo-by-construction test on the WonGi ad: the model left the logo area plain; `compose_final` drew the real logo file and a light grain (Cloudflare Images binding). No lighter box. Waiting for the owner to pick A or B. | agent | Owner asked for a side-by-side test. Lesson: logo files carry transparent padding, so the brand kit must store a trimmed logo before placement numbers mean anything. |
| 2026-11-07 | Food realism: no loose painted food unless the idea needs it; the brand's real close-up photo goes in as the texture reference for the final. | agent, from the owner's mark | The kernels in the test look matte and real; the loose kernels were the worst AI tell. |
| 2026-11-07 | Deploys go through R2 staging (`/admin/stage`) and the connector, never through hand-copied bundles (`docs/deploy.md`). A preview Worker `a11adgen-preview` tests branches. | agent | A hand-copied 24 KB bundle failed with one wrong character. |
| 2026-11-07 | **Approved: logo by construction + real-photo texture (option B).** Finals leave the logo area plain; `compose_final` draws the real logo file; the brand's real close-up photo is the food texture reference. This reverses v1 #196 (keep the painted logo). | han | "b: (new) real logo file + real photo texture looks so much better and definitely usable." |
