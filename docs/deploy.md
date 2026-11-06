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
5. Smoke test: `spend_get` through `/mcp`, and one call of each changed tool.

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
| `a11adgen` | Live. Deploys only `main`. | `FAL_KEY`, `EXA_API_KEY` |
| `a11adgen-preview` | Tests a branch before its PR merges. Same D1 and R2 (see below). | none (no paid calls from it) |

### Preview rules (shared D1 and R2)

The preview uses the live D1 and R2, so it can test with real renders. It has no secrets, so it cannot call fal or Exa. Rules:

- Never run a D1 migration from a branch or against the preview. Migrations run only from `main`, after merge.
- A branch may only add rows and objects (`renders/<id>/<n>-c.jpg`, `spend` rows at US$0, `deploy/<name>`). It must not update or delete live rows or objects.
- A branch that changes the schema or deletes data gets its own D1 and R2 (prefix `a11adgen-preview-`) before it is deployed to the preview.
