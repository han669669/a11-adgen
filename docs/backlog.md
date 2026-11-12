# Backlog

This document uses ASD-STE100 Simplified Technical English with British spelling.

The owner decides what moves out of this list. An agent does not start a backlog item without the owner's say. An agent may add an idea here and tell the owner. The repo is public: never write a secret, a hash, a private link or an open weakness in this file.

## Backlog (not needed now)

| Item | Why it could matter | Owner decision |
| --- | --- | --- |
| Alert the owner when a client comments or uploads | The owner sees feedback at once. | Backlog, 2026-11-08 |
| Weekly client reminder (Cron job) | The client does not forget to send results. | Backlog, 2026-11-08 |
| Cron job that checks the canon is healthy | Stops quiet drift in the house recipe. | Backlog, 2026-11-08 |
| Authentication hardening | Fewer doors to try. | Not now, 2026-11-08 |
| Connector icon (the a11 logo) in the claude.ai connector list | Cosmetic only. The server already publishes the logo (`serverInfo.icons`, `/icon.png`, `/favicon.ico`). claude.ai does not read it for custom connectors: it takes a favicon for the last two labels of the host, which is `workers.dev` for us (upstream issue `anthropics/claude-ai-mcp#152`, open on 2026-11-08). A fix needs a custom domain the owner owns, or Anthropic to read `serverInfo.icons`. | Parked, 2026-11-08. Wait for Anthropic. Option kept in the backlog at the owner's request: a custom domain for the Worker. It costs owner time, needs a domain the owner owns, changes the connector URL (every connector must be added again) and needs a new security check (OAuth addresses, cookies, `a11studio.pro` stays untouched). Agent advice: no, it is cosmetic. |
| `/favicon.ico` content type | Small tidy-up. | Pending |
| A block for the two-finger sideways trackpad swipe on desktop | Avoids a stray back gesture in the app. | Optional |
| Account-owned build token, when Workers Builds supports it | A build token that does not depend on one user. | Later |
| Delete merged local branches | Keeps the checkout tidy. Needs the owner's approval first. | Ask first |
| Live test of the `/a11:` short commands in a fresh plugin session | Proves that the plugin menu, the arguments and the server text work together for a real user. Done on 2026-11-09: a live `prompt_get` call returned text for all 8 commands, and the 2 refusal cases (`final` with no `batchId`, `learn` with a `note`) gave the correct error. The automated in-process test of all 8 commands is in `tests/mcp.test.ts` (PR #58). Still open: type each `/a11:<name>` in a fresh session after a plugin update. It starts paid work, so it waits for a real batch. | Backlog, 2026-11-09 |
| Learn from real client results (results upload, baseline CTR, week report, canon changes from winners and losers) | The loop can only learn from real Meta numbers. Cat & the Fiddle and WonGi are real brands used only to refine the tool, not paying clients, so they have no results to send. The code is built (Phase 3b); it waits for the first paying client. | Backlog, 2026-11-09 |
| Revoke the old W47 Cat & the Fiddle pack versions (v1 to v4) | Only the newest pack (v5, box-printed finals) stays live. One of the old versions holds the owner's comments and uploaded files, so a revoke must not lose them. The feature to update the ads and the Meta text of an existing pack in place is a separate task. | Keep all versions live. Owner, 2026-11-11: revoke none of them until a real client makes it necessary. He will use the v3 link in his cold outreach template, so v3 stays live and unchanged. |
| Improvement plans from the `improve` pass of 2026-11-11 (`plans/README.md`) | 6 ready plans (docs truth pass, one batch flow text and a blind draft order, the paid render path, security hardening, `pack_publish` copy reuse, a design for saving every owner verdict), a list of smaller findings and 4 direction options. Each plan names its goal. No code changed in that pass. | Approved by the owner, 2026-11-11: run plans 001 to 005, one pull request each, in order. Plan 006: the design only; he decides the build later (it needs a live D1 migration). The status of each plan is in `plans/README.md`. |

## Declined by the owner (do not suggest again)

| Item | Owner decision |
| --- | --- |
| A studio reply under each client comment | Declined, 2026-11-08. It annoys the owner and the client. |
| A review of the other Workers in the account | Declined, 2026-11-08. |
| A secure credential form so agent sessions can call the admin routes | Declined, 2026-11-08. The owner runs those steps. |
| A change to the request-log settings | Declined, 2026-11-08. Leave as it is. |
