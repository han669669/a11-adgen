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

- `main` needs a pull request and the cubic check. No force push, no deleting `main`. A push to `main` is a production deploy.
- This path deploys the Worker only. The web app files in R2 `app/` (step 5 below) and D1 migrations (step 3 below) are still manual.
- After each automatic deploy, check `/api/me` (401), the test portal link (200) and `spend_get` through `/mcp`.
- Before the first automatic deploy, back up the live `MCP_TOKEN_SHA256` and `SIGNUP_CODE_SHA256` values. Read them in the dashboard (Worker, Settings, Variables and Secrets) and keep a copy in a private note. Do not commit them. `keep_vars` was verified on 2026-11-08: both values were still on the Worker, unchanged, after the first automatic deploy.
- Known risk, accepted by the owner on 2026-11-08 (no expiry, and the scope below): the build token has no expiry, and `Workers Scripts: Edit` covers every Worker in this account, not only `a11adgen`. A leaked token could replace the code of any of them. It cannot directly call the zone, KV, R2 or D1 APIs, but replacement code can use the bindings of an affected Worker, including its secrets and data. Cloudflare Builds takes only user tokens today. A token limited to one Worker needs an account-owned token. When Builds supports those, switch to one limited to `a11adgen`, and give it an expiry.
- Roll back by deploying the last good version in the dashboard (Worker, Deployments), or `PUT` it again with the connector. Plain values set outside the file (`MCP_TOKEN_SHA256`, `SIGNUP_CODE_SHA256`) are not in git. If one is lost, restore it from the backup. It is a hash, not a secret.

## Manual deploy (fallback)

### Steps

The steps below are for the live Worker `a11adgen` (D1 `a11adgen-db`, R2 `a11adgen-assets`), and only from `main` after a merge. For a branch, use the same steps with the preview targets in "Preview deploy" below. Never the live ones.

1. Build: `npx wrangler deploy --dry-run --minify --outdir .wrangler/dry`. Note the SHA-256 of `.wrangler/dry/entry.js` (the Worker entry is `worker/entry.ts`).
2. Stage: `PUT /admin/stage/<name>.js` on the target Worker, with the `/mcp` bearer token and the bundle as the body. It saves `deploy/<name>.js` in that Worker's R2 bucket. Stage each new SQL file in `migrations/` the same way.
3. D1 migrations, before the new code goes live (the code may need the new tables): in the connector, read each staged SQL file, check its SHA-256, run it with the D1 query API on the target database, then insert its name into `d1_migrations`. Skip a file already listed there.
4. Deploy with the connector: read `deploy/<name>.js` from the target bucket, check its SHA-256 against step 1, then `PUT /accounts/{id}/workers/scripts/<worker>` (multipart): upload the bundle as a JavaScript module part named `index.js` (`application/javascript+module`) and set metadata `main_module` to `index.js`, with:
   - `compatibility_date` `2026-10-20`, `compatibility_flags` `["nodejs_compat"]`;
   - the bindings in `wrangler.jsonc` (including `{ "type": "images", "name": "IMAGES" }` and the KV namespace `OAUTH_KV` = live `a11adgen-oauth` `e29131310aa446489fa715d74e1c35ff`, for `a11adgen` only; a preview deploy uses its own, see the Preview deploy table), plus `MCP_TOKEN_SHA256` and `SIGNUP_CODE_SHA256` as `plain_text` (hashes only; not in `wrangler.jsonc`);
   - `keep_bindings: ["secret_text"]`, so the owner's `FAL_KEY`, `EXA_API_KEY` and `ALLOWED_EMAILS` stay.
5. Web app: `npm run build:app`, then `PUT /admin/app/<path>` on the target Worker (same bearer token) for each file in `dist/app`, `index.html` last. It saves to `app/` in that Worker's bucket, and the Worker serves the app from there. Old hashed files in `app/assets/` can stay; `index.html` points to the new ones.
6. Smoke test: `spend_get` through `/mcp`, `/api/me` (401 without a session), and one call of each changed tool.

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
| `a11adgen` | Live. Deploys only `main`. | `FAL_KEY`, `EXA_API_KEY`, `ALLOWED_EMAILS` (web app sign-in) |
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
