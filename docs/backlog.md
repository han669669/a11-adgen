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
| Learn from real client results (results upload, baseline CTR, week report, canon changes from winners and losers) | The loop can only learn from real Meta numbers. Cat & the Fiddle and WonGi are real brands used only to refine the tool, not paying clients, so they have no results to send. The code is built (Phase 3b); it waits for the first paying client. | Backlog, 2026-11-09 |

## Declined by the owner (do not suggest again)

| Item | Owner decision |
| --- | --- |
| A studio reply under each client comment | Declined, 2026-11-08. It annoys the owner and the client. |
| A review of the other Workers in the account | Declined, 2026-11-08. |
| A secure credential form so agent sessions can call the admin routes | Declined, 2026-11-08. The owner runs those steps. |
| A change to the request-log settings | Declined, 2026-11-08. Leave as it is. |
