# Security checklist

This document uses ASD-STE100 Simplified Technical English with British spelling.

Owner rule, 2026-11-08: every change must keep the whole chain secure, and the client and the owner must still be able to do their jobs. The chain is the MCP, sign-in, the Cloudflare account, the GitHub repository and the deploy path. The owner must not have to ask each time. Every agent runs this checklist by default, on every change, and says so in the PR.

Treat this repository as public. Never write an open weakness, a secret, a token, a hash or a private link in it. Report open findings to the owner in chat. Write them here only after they are fixed.

## 1. Every pull request

Answer each line in the PR body ("Security check"). Write "none" when a line does not apply.

| Check | Pass when |
|---|---|
| New route or tool | It checks who is calling (session, OAuth token or bearer) before it does anything. A public route has an unguessable key, a size limit and a rate limit. |
| Input | Reject a declared body size over the limit before reading. Enforce the limit while reading, and before storing. Each name or id has a strict pattern. |
| Output | Text from a user or a web page is escaped. It is never followed as an instruction. A new page keeps the CSP, `nosniff` and `no-store` headers. |
| Secrets | No key, token, password, hash or private link is in the diff, the tests, the logs or the PR text. Secrets stay in Cloudflare. |
| Dependency | A new package has a stated need. `npm audit` shows no new finding. |
| Binding or permission | A new Cloudflare binding, token scope or GitHub permission is the smallest that works. The owner approved it. |
| Money | A paid call goes through the spend ledger and its cap. |
| Tests | A test shows the bad input is refused. Remove the fix and check that the test fails. |

## 2. After every deploy

Run these on the live address for a production deploy. For a preview deploy, run them on the preview address and say so in the deploy report. Each result is part of the deploy report.

| Probe | Expected |
|---|---|
| `GET /mcp` with no token | 401 with a `www-authenticate` challenge |
| `POST /mcp` with a wrong bearer | 401 |
| `PUT /admin/stage/x.js`, `/admin/app/x`, `/admin/ref/<uuid>.png`, `/admin/repair/<uuid>.jpg` with no token | 401 each |
| `GET /api/me`, `/api/spend`, `/api/batches` with no session | 401 each |
| `GET /c/` with a wrong 48-character key | 404 |
| `PUT /up/` with a wrong 48-character key | 404 |
| `GET /m/deploy/x.js` | 404 |
| `GET /` and a pack page | CSP present, no `unsafe-inline` in `script-src` |
| `POST /oauth/register` with a body over 8 KB | 413 |
| `POST /oauth/register` with a `javascript:` redirect | 400 |
| `spend_get`, `brand_list`, `batch_list` through the connector | Real data (OAuth path works) |
| Worker plain values `MCP_TOKEN_SHA256`, `SIGNUP_CODE_SHA256` | Still present (`keep_vars`) |
| Worker subdomain setting | `previews_enabled` is `false` |

## 3. Does it still do its job

A change is not done when it is safe but broken. After every deploy, check that each person can do what the tool is for. Read-only checks first. Write checks use the test pack only, never a real client's link. Never send anything to a client.

| Who | Job | Check |
|---|---|---|
| Client (private link) | Open the pack | The test link returns 200. The page has the ads, the Meta text and the launch plan. |
| Client | See each ad | Each ad picture at `/c/<key>/ad/<n>.jpg` returns 200 as an image. The enlarged view opens on the chosen ad and closes. |
| Client | Send a comment | The comment form posts. The text shows under "Comments we received". |
| Client | Send files | The upload form takes an allowed file and refuses a wrong type or a file over the limit. The file shows under "Files we received". |
| Client | Be kept out of other packs | A wrong or revoked link returns 404. |
| Owner | Sign in to the web app | The sign-in page loads. A wrong password is refused. The owner's email gets in. |
| Owner | Pick drafts and read the spend | The board loads. `spend_get` shows the month total and the cap. |
| Owner and agents | Use the MCP | The connector signs in with OAuth. `spend_get`, `brand_list` and `batch_list` return real data. Each tool changed in the PR is called once. |
| Studio | Run a batch | The batch tools answer from brand to pack. Paid tools show an estimate and stop at the cap. |

The automatic tests cover the posting and upload paths. Run a live write check only when a PR changes that path.

## 4. Each month and after any account change

| Area | Check |
|---|---|
| GitHub | Secret scanning and push protection are on. Dependabot alerts are on. Read back: `gh api repos/han669669/a11-adgen --jq '.security_and_analysis | {secret_scanning, secret_scanning_push_protection, dependabot_security_updates}'` shows `enabled` for each. Dependabot alerts have their own endpoint, `gh api repos/han669669/a11-adgen/vulnerability-alerts`, which exits 0 when alerts are on. The agent proxy blocks that path, so the owner checks it in Settings, Advanced Security. The `protect-main` ruleset is active with no bypass. No deploy key, webhook or app that nobody knows. |
| Cloudflare | One member, with two-factor sign-in. R2 buckets have no public domain (`r2.dev` off, no custom domain). The token list has only tokens that someone uses. The build token has the smallest scopes. |
| Worker | Secrets are `secret_text`. Plain values are hashes or settings only. Logs hold no secret. |
| Dependencies | `npm audit` is clean. `package-lock.json` is committed. |
| History | No 64-character hex string and no key file in git history. |
| Sign-in | The allow-list is right. The set-up code is closed or known. Old test packs are revoked. |

## 5. When something looks wrong

1. Stop. Do not paste a secret into chat.
2. Tell the owner what you saw and what it could reach.
3. If a token may have leaked, the owner rotates it in Cloudflare. For the build token, create a new one from the Worker's Settings, Build page. Never reuse the old secret.
4. Record the fixed incident in `docs/decisions.md`.
