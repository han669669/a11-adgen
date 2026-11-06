# Deploy

There is no Cloudflare API token in the session (owner decision). Deploys go through the Cloudflare connector, and the bundle reaches it through R2, so no large text is copied by hand.

## Steps

1. Build: `npx wrangler deploy --dry-run --minify --outdir .wrangler/dry`. Note the SHA-256 of `.wrangler/dry/index.js`.
2. Stage: `PUT /admin/stage/<name>.js` on a deployed Worker (`a11adgen` or `a11adgen-preview`), with the `/mcp` bearer token and the bundle as the body. It saves `deploy/<name>.js` in R2 `a11adgen-assets`.
3. Deploy with the connector: read `deploy/<name>.js` from R2 (`GET /accounts/{id}/r2/buckets/a11adgen-assets/objects/deploy/<name>.js`), check its SHA-256 against step 1, then `PUT /accounts/{id}/workers/scripts/<worker>` (multipart): upload the bundle as a JavaScript module part named `index.js` (`application/javascript+module`) and set metadata `main_module` to `index.js`, with:
   - `compatibility_date` `2026-10-20`, `compatibility_flags` `["nodejs_compat"]`;
   - the bindings in `wrangler.jsonc`, plus `MCP_TOKEN_SHA256` as `plain_text` (it is not in `wrangler.jsonc`);
   - `keep_bindings: ["secret_text"]`, so the owner's `FAL_KEY` and `EXA_API_KEY` stay.
4. Images binding: metadata `bindings` must include `{ "type": "images", "name": "IMAGES" }` (`compose_final` needs it).
5. Web app: `npm run build:app`, then `PUT /admin/app/<path>` (same bearer token) for each file in `dist/app`, `index.html` last. The Worker serves the app from R2 `app/`. Old hashed files in `app/assets/` can stay; `index.html` points to the new ones.
6. D1 migrations: run each new file in `migrations/` through the connector's D1 query API (stage the SQL with `/admin/stage`, check its SHA-256), then insert its name into `d1_migrations`.
7. Smoke test: `spend_get` through `/mcp`, and one call of each changed tool.

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

### Preview rules

The preview has its own D1 and R2 (a branch with a schema change needed them first). It has no secrets, so it cannot call fal or Exa. Rules:

- Never run a branch's D1 migration against the live `a11adgen-db`. Migrations run on the live database only from `main`, after merge. The preview database may get a branch's migrations.
- A branch may only add rows and objects (`renders/<id>/<n>-c.jpg`, `spend` rows at US$0, `deploy/<name>`). It must not update or delete live rows or objects.
- A branch that changes the schema or deletes data gets its own D1 and R2 (prefix `a11adgen-preview-`) before it is deployed to the preview.
