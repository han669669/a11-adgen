# Deploy

There is no Cloudflare API token in the session (owner decision). Deploys go through the Cloudflare connector, and the bundle reaches it through R2, so no large text is copied by hand.

## Automatic deploy (Workers Builds)

Connected on 2026-11-08 (recorded in `docs/decisions.md`). The live Worker `a11adgen` is built and deployed by Cloudflare when a commit lands on `main`. No Cloudflare token is in the session. The manual steps below stay as the fallback. The first automatic deploy passed on 2026-11-08 (see `docs/decisions.md`). Still check each deploy as listed below.

| Setting | Value | Why |
|---|---|---|
| Git repository | `han669669/a11-adgen` only | The Cloudflare GitHub app must not see other repositories. |
| Production branch | `main` | |
| Non-production branch builds | **Off** (`previews_enabled: false`, set and read back on 2026-11-08) | A branch build would run branch code with the live bindings. Cloudflare turns them on by default. |
| Build command | `npm run typecheck && npm test` | A red check stops the build, so nothing deploys. |
| Deploy command | `npx wrangler deploy` | `keep_vars` and `secrets.required` in `wrangler.jsonc` protect the live values. |
| Build token | `a11adgen-builds`: `Workers Scripts: Edit` and `Account Settings: Read`, this account only. No zone, KV, R2 or D1 permission. No expiry (owner choice). | The default token can change routes on every zone, including a11studio.pro. |
| Build variable | `CLOUDFLARE_ACCOUNT_ID` = `88581e9852ace13f81f9f45196911c85` | Lets the token stay small. |

Rules:

- `main` needs a pull request. No force push, no deleting `main`. A push to `main` is a production deploy. The cubic check runs on every pull request, but the `protect-main` ruleset does not require it (owner, 2026-11-09). Before a merge, check that cubic is green.
- This path deploys the Worker only. The web app files in R2 `app/` (step 5 below) and D1 migrations (step 3 below) are still manual.
- After each automatic deploy, check `/api/me` (401), the test portal link (200) and `spend_get` through `/mcp`. Workers Logs keep no invocation logs (`wrangler.jsonc`: they would keep the pack-link token from the URL). To see one request, use `wrangler tail`, which is not stored. Also read `GET /accounts/{id}/workers/scripts/a11adgen/subdomain`: `previews_enabled` must be `false`.
- The dashboard may say "Update your Wrangler configuration with these changes" after a variable edit. Ignore it. Do not put `MCP_TOKEN_SHA256` or `SIGNUP_CODE_SHA256` in `wrangler.jsonc` vars: the repo is public. Both are Worker secrets since 2026-11-12, so a deploy keeps them, and a deploy stops when `MCP_TOKEN_SHA256` is missing (`secrets.required`).
- A secret cannot be read back. When the owner sets `MCP_TOKEN_SHA256` or `SIGNUP_CODE_SHA256`, he keeps a copy of the value (or of the token or code it comes from) in a private note, never in git. If `MCP_TOKEN_SHA256` is lost, the owner makes a new admin token and sets its hash as the secret ("The admin token" in `AGENTS.md`). If `SIGNUP_CODE_SHA256` is lost, sign-up stays closed until the owner sets the hash of a new set-up code. Neither is in git.
- Known risk, accepted by the owner on 2026-11-08 (no expiry, and the scope below): the build token has no expiry, and `Workers Scripts: Edit` covers every Worker in this account, not only `a11adgen`. A leaked token could replace the code of any of them. It cannot directly call the zone, KV, R2 or D1 APIs, but replacement code can use the bindings of an affected Worker, including its secrets and data. Cloudflare Builds takes only user tokens today. A token limited to one Worker needs an account-owned token. When Builds supports those, switch to one limited to `a11adgen`, and give it an expiry.
- Roll back by deploying the last good version in the dashboard (Worker, Deployments), or `PUT` it again with the connector. A rollback keeps the Worker's secrets.

## Manual deploy (fallback)

### Steps

The steps below are for the live Worker `a11adgen` (D1 `a11adgen-db`, R2 `a11adgen-assets`), and only from `main` after a merge. For a branch, use the same steps with the preview targets in "Preview deploy" below. Never the live ones.

1. Build: `npx wrangler deploy --dry-run --minify --outdir .wrangler/dry`. Note the SHA-256 of `.wrangler/dry/entry.js` (the Worker entry is `worker/entry.ts`).
2. Stage: `PUT /admin/stage/<name>.js` on the target Worker, with the `/mcp` bearer token and the bundle as the body. It saves `deploy/<name>.js` in that Worker's R2 bucket. Stage each new SQL file in `migrations/` the same way.
3. D1 migrations, before the new code goes live (the code may need the new tables): in the connector, read each staged SQL file, check its SHA-256, run it with the D1 query API on the target database, then insert its name into `d1_migrations`. Skip a file already listed there.
4. Deploy with the connector: read `deploy/<name>.js` from the target bucket, check its SHA-256 against step 1, then `PUT /accounts/{id}/workers/scripts/<worker>` (multipart): upload the bundle as a JavaScript module part named `index.js` (`application/javascript+module`) and set metadata `main_module` to `index.js`, with:
   - `compatibility_date` `2026-10-20`, `compatibility_flags` `["nodejs_compat"]`;
   - the bindings in `wrangler.jsonc` (including `{ "type": "images", "name": "IMAGES" }` and the KV namespace `OAUTH_KV` = live `a11adgen-oauth` `e29131310aa446489fa715d74e1c35ff`, for `a11adgen` only; a preview deploy uses its own, see the Preview deploy table), and `observability` `{ "enabled": true, "logs": { "invocation_logs": false } }` (no invocation logs, as in `wrangler.jsonc`);
   - `keep_bindings: ["secret_text"]`, so the Worker's secrets stay: `FAL_KEY`, `EXA_API_KEY`, `ALLOWED_EMAILS`, `APIFY_TOKEN`, `MCP_TOKEN_SHA256` and `SIGNUP_CODE_SHA256`. Never send the two hashes as `plain_text`.
   - After the upload, turn per-version URLs off: `POST /accounts/{id}/workers/scripts/<worker>/subdomain` with `{"enabled": true, "previews_enabled": false}`. A connector upload does not read `preview_urls` from `wrangler.jsonc`.
5. Web app: `npm run build:app`, then `PUT /admin/app/<path>` on the target Worker (same bearer token) for each file in `dist/app`, `index.html` last. It saves to `app/` in that Worker's bucket, and the Worker serves the app from there. Old hashed files in `app/assets/` can stay; `index.html` points to the new ones.
6. Smoke test: `spend_get` through `/mcp`, `/api/me` (401 without a session), one call of each changed tool, and `previews_enabled` is `false` on the Worker's subdomain setting.

## One-time assets

`compose_final` reads the grain tile from R2 `a11adgen-assets/assets/grain.png`. The repo copy is `assets/grain.png`. A new bucket needs it uploaded once:

```bash
npx wrangler r2 object put a11adgen-assets/assets/grain.png --file assets/grain.png --content-type image/png --remote
```

With no API token in the session, do the same through the connector (`PUT /accounts/{id}/r2/buckets/a11adgen-assets/objects/assets/grain.png`, body the PNG bytes). Without it, `compose_final` with `grain: "on"` fails with "Grain tile missing". It was uploaded to `a11adgen-assets` on 2026-11-07.

## Why not copy the bundle into the connector call

On 2026-11-07 a 24 KB bundle copied by hand into a connector call had one wrong character and failed with a syntax error. The connector cannot fetch outside URLs (tested), so R2 is the path. If no Worker with `/admin/stage` is deployed, send the bundle gzipped in chunks, each with its SHA-256 checked in the connector before use.

## Workers

| Worker | Use | Secrets |
|---|---|---|
| `a11adgen` | Live. Deploys only `main`. | `FAL_KEY`, `EXA_API_KEY`, `ALLOWED_EMAILS` (web app sign-in), `APIFY_TOKEN`, `MCP_TOKEN_SHA256` and `SIGNUP_CODE_SHA256` (hashes only) |
| `a11adgen-preview` | Tests a branch before its PR merges. Since 2026-11-07 it uses its own D1 `a11adgen-preview-db` (`2c28c64f-f8c0-46f9-9e2d-7ca70d2a0f70`) and R2 `a11adgen-preview-assets`, both APAC. | none (no paid calls from it); `ALLOWED_EMAILS` is a plain test address |

### Preview deploy

Deploy a branch to `a11adgen-preview` with the same steps, but with these bindings (never the live ones):

| Binding | Preview value |
|---|---|
| `DB` | D1 `a11adgen-preview-db` (`2c28c64f-f8c0-46f9-9e2d-7ca70d2a0f70`) |
| `MEDIA` | R2 `a11adgen-preview-assets` |
| `OAUTH_KV` | KV `a11adgen-preview-oauth` (`830b5d7881a049fb8712411763495000`) |
| `PUBLIC_BASE_URL` | `https://a11adgen-preview.gamingcomputing.workers.dev` |
| `ALLOWED_EMAILS` | a plain test address, not the owner's list |
| `SIGNUP_CODE_SHA256` | the hash of a test code, never the live one (or leave it out to keep sign-up closed) |

Stage preview bundles and SQL through `a11adgen-preview` (they land in `a11adgen-preview-assets/deploy/`), and read them from that bucket in the connector.

### Preview rules

The preview has its own D1 and R2 (a branch with a schema change needed them first). It has no secrets, so it cannot call fal or Exa. Rules:

- Never run a branch's D1 migration against the live `a11adgen-db`. Migrations run on the live database only from `main`, after merge. The preview database may get a branch's migrations.
- A branch may only add rows and objects (`renders/<id>/<n>-c.jpg`, `spend` rows at US$0, `deploy/<name>`). It must not update or delete live rows or objects.
- A branch that changes the schema or deletes data gets its own D1 and R2 (prefix `a11adgen-preview-`) before it is deployed to the preview.
