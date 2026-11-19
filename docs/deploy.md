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

- `main` needs a pull request. No force push, no deleting `main`. A push to `main` is a production deploy. The review bot runs on every pull request, but the `protect-main` ruleset does not require it (owner, 2026-11-09). The review bot is Devin Review 2.0, for all code and security review (the owner's standing rule, recorded 19-11-2026). It replaces Macroscope (17-11-2026) and cubic. It reviews each pull request and writes its findings as comments. Before a merge, check that its review of the newest commit is done and that each finding is fixed or answered.
- This path deploys the Worker only. After a merge that changes the web app, an agent publishes the web app files to R2 `app/` with the MCP tool `app_publish` ("Web app publish" below). D1 migrations (step 3 below) are still manual.
- Each deploy builds the web app first (`build.command` in `wrangler.jsonc`), because the Worker bundle holds the SHA-256 of each file of that build (`dist/app-manifest.json`). A web app that does not build stops the deploy.
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
   - the bindings in `wrangler.jsonc` (including `{ "type": "images", "name": "IMAGES" }` and the KV namespace `OAUTH_KV` = live `a11adgen-oauth` `e29131310aa446489fa715d74e1c35ff`, for `a11adgen` only; a preview deploy uses its own, see the Preview deploy table), and `observability` `{ "enabled": true, "logs": { "enabled": true, "invocation_logs": false } }` (no invocation logs, as in `wrangler.jsonc`);
   - `keep_bindings: ["secret_text"]`, so the Worker's secrets stay: `FAL_KEY`, `EXA_API_KEY`, `ALLOWED_EMAILS`, `APIFY_TOKEN`, `MCP_TOKEN_SHA256` and `SIGNUP_CODE_SHA256`. Never send the two hashes as `plain_text`.
   - After the upload, turn per-version URLs off: `POST /accounts/{id}/workers/scripts/<worker>/subdomain` with `{"enabled": true, "previews_enabled": false}`. A connector upload does not read `preview_urls` from `wrangler.jsonc`.
5. Web app: an agent publishes the build with the MCP tool `app_publish` of the target Worker ("Web app publish" below). The files go to `app/` in that Worker's bucket, and the Worker serves the app from there. Old hashed files in `app/assets/` can stay; `index.html` points to the new ones. The fallback is `PUT /admin/app/<path>` with the admin token (`scripts/upload_app.sh`), which only the owner can run.
6. Smoke test: `spend_get` through `/mcp`, `/api/me` (401 without a session), one call of each changed tool, and `previews_enabled` is `false` on the Worker's subdomain setting.

## Web app publish (step 5)

A merge does not put a web app change on the live site: Workers Builds deploys the Worker only. An agent then publishes the web app build of `main` with the MCP tool `app_publish`. It needs no admin token, and the owner runs nothing (owner, 19-11-2026). Claude Code and Devin use the same steps. They need git, Node 22 and curl.

What the tool can do, and no more:

| Question | Answer |
|---|---|
| Who can call it | A caller of `/mcp`: an OAuth client that the owner signed in and approved, or the admin token. |
| What can go live | Only the web app build of the commit that the Worker runs. Each deploy builds the web app and puts the SHA-256 of each built file into the Worker bundle. The Worker saves a file to R2 `app/` only when its name and its SHA-256 are in that list. Other JavaScript is refused (HTTP 422), also with a valid link. |
| How code gets into the list | Only by a merge to `main` (the owner's merge, or the merge rule in `AGENTS.md` section 9) and its deploy. |
| The upload link | 24 random bytes, for the files of one publish. Only its SHA-256 is kept (R2 `app-publish/`, which no route serves). It works for 15 minutes, and a new `app_publish` call replaces it. Never write it in a PR, a log or a chat. |
| Order | The Worker refuses `index.html` until each file it needs is in R2 with the right SHA-256. A publish that stops early changes nothing for a user. |
| Rollback | `rollback: true` puts back the page that the last publish replaced. It cannot put any other page live. |
| Record | Workers Logs keep one line for each step (`"event":"app_publish"`: `link`, `file`, `refused`, `rollback`), never the link. They do not name the caller. |

Steps, after the deploy of the merge:

1. `git switch main && git pull --ff-only && git status --porcelain` (it prints nothing when the checkout is clean), then `npm ci && npm run build:app`.
2. Call `app_publish` with no arguments. The answer lists each file of the build with `live` true or false, and has one `curl` line for each file that is not live. If the answer names a file that is not in your `dist/app`, the Worker does not run your commit: wait for the deploy, or pull `main`.
3. Run the `curl` lines from the repo root, in the order given. `index.html` is last and makes the build live. A 422 answer means the same as in step 2.
4. Call `app_publish` again: `live` must be true. Then run the proof below, and reload any open tab (an open tab keeps the old app until a reload).

Anyone can make the same proof with no token and no tool, from a build of the same commit:

```bash
B=https://a11adgen.gamingcomputing.workers.dev
curl -fsS $B/ | sha256sum; sha256sum dist/app/index.html
for a in $(grep -oE 'assets/[A-Za-z0-9._-]+' dist/app/index.html | sort -u); do curl -fsS $B/$a | sha256sum; sha256sum dist/app/$a; done
```

Rollback:

- The new build is broken: call `app_publish` with `rollback: true`. The page that the publish replaced is live again at once. Tell the owner, then revert the change on `main`.
- To stay on an older build: revert the change on `main`. After that deploy the Worker takes only the older build. Publish it with `app_publish`.
- The owner's fallback, with the admin token: `scripts/rollback_app.sh` (below).

`tests/app-publish.test.ts` covers the tool and the route: other bytes, a name that is not in the build, `index.html` too early, a file in R2 without its SHA-256, a wrong, expired or replaced link, the size limits and the rollback. For a preview, call `app_publish` on the preview Worker: it takes the build of the branch it was deployed from.

### Fallback: upload with the admin token (owner only)

Use this only when the MCP is down. The owner runs it on his own computer, because only he holds the admin token (`AGENTS.md`, section 7). It needs bash, git, Node 22 and curl 7.55 or later.

```bash
git switch main && git pull --ff-only && git status --porcelain   # prints nothing when the checkout is clean
npm ci && npm run check && npm run build:app
DRY_RUN=1 scripts/upload_app.sh   # all checks, no upload
scripts/upload_app.sh             # the upload
```

The script asks for the admin token and does not show it. It does not print the token, save it or put it on a command line. Do not run it with `bash -x`. For a preview, set `BASE` to the preview origin.

What `scripts/upload_app.sh` does, in this order. It stops at the first check that fails.

1. It checks each file of `dist/app` against the rules of the route (name, content type, 3 MB limit), and prints the commit and the SHA-256 of each file.
2. It saves the live `index.html` in `rollback-app/<UTC time>/` (not in git) and checks that the files it names are live. R2 keeps no old versions, so this is the only copy of the old page.
3. It checks the token with `PUT /admin/stage/BAD%20NAME`: 400 with a valid token, 401 without. This request writes nothing. `DRY_RUN=1` stops here.
4. It uploads each file, `index.html` last. After each upload it reads the file back from the site and compares the SHA-256.
5. Proof: live `/` has the same SHA-256 as `dist/app/index.html`, and the script prints the file names in the live page. They must be the names that `npm run build:app` printed.

An upload that stops before `index.html` changes nothing for a user: the live page still names the old files. Run the script again. After the upload, an open browser tab keeps the old app until a reload.

Rollback: `BASE=<origin> ROLLBACK=rollback-app/<UTC time> scripts/rollback_app.sh`. The upload prints this line with its own target, so a rollback of a preview does not go to the live site. It checks that the files in the saved page are still live, puts the saved `index.html` back with one `PUT`, and checks that live `/` is equal to it. The new hashed files can stay.

`tests/app-upload.test.ts` runs both scripts against the Worker code on a local port: a wrong token, a dry run, a build with a missing file, the upload order and the rollback.

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
