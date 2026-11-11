# Plan 003: A paid render is never lost, charged twice or given the wrong logo

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before you go to the
> next step. If a "STOP condition" occurs, stop and report. Do not improvise.
> When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4062fb1..HEAD -- worker/fal.ts worker/batch.ts worker/mcp.ts worker/picks.ts tests/fal.test.ts tests/batch.test.ts`
> If an in-scope file changed, compare the "Current state" excerpts with the
> live code first. A mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (it changes the paid path; every case has a test)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4062fb1`, 2026-11-11

## Why this matters

Finals are the paid, client-facing output. Four defects in this path can lose
a paid final, charge for a second one, block a pick for ever, or draw another
brand's logo on a final:

1. `fal.check` marks a finished render `failed` for ever when one image
   download gets a temporary error (HTTP 5xx or 429 from the image host).
2. `fal.check` writes its result without a status guard. The board polls
   every 8 seconds and the agent polls too; a late failing poll can overwrite
   `done` with `failed`.
3. `finalRender` claims a pick with `pending:<uuid>` and nothing ever expires
   the claim. If the Worker stops between the claim and the fal call, the pick
   says "already started" for ever. And when fal accepted the job but the row
   insert failed, the claim is released, so a retry pays for a second final.
4. `compose_final` with a `brandSlug` that does not own the render silently
   uses that brand's newest logo.

This serves Goal 2: the ad that reaches the client is the one the owner chose,
with the correct logo, and the spend stays true.

## Current state

Files:
- `worker/fal.ts` — `submit` (line 50) starts a paid render; `check` (line
  108) polls it and copies images to R2; `transient` (line 162).
- `worker/batch.ts` — `finalRender` (line 277).
- `worker/api.ts` — `claimCompose` (line 30): the existing pattern for a claim
  with a time stamp that goes stale.
- `worker/mcp.ts` — the `compose_final` tool handler (lines 849-878).
- `worker/picks.ts:93` — reads `final_render_id?.startsWith("pending:")`.
- Tests: `tests/fal.test.ts` (3 tests of `check`), `tests/batch.test.ts`
  (`describe("compose_final with brandSlug")` at line 399; final render tests
  near line 360), `tests/helpers/d1.ts` (a node:sqlite fake of D1).

Excerpts (read at `4062fb1`):

`worker/fal.ts:131-158`
```ts
  for (const [i, img] of images.entries()) {
    const file = await fetch(img.url, { signal: AbortSignal.timeout(15_000) });
    if (!file.ok) continue;
    const key = `renders/${id}/${i + 1}.jpg`;
    ...
  }
  // A short download is a failure (cubic, PR #1); the saved keys stay listed, so the images remain usable.
  const status = keys.length > 0 && keys.length === images.length ? "done" : "failed";
  const error =
    images.length === 0 ? "fal returned no images" : keys.length === images.length ? null : `saved ${keys.length} of ${images.length} images`;
  await env.DB.prepare("UPDATE renders SET status = ?, image_keys = ?, error = ?, updated_at = ? WHERE id = ?")
    .bind(status, JSON.stringify(keys), error, new Date().toISOString(), id)
    .run();
  return view(env, { ...row, status, error, image_keys: JSON.stringify(keys) });
```
The status and result calls above this loop already use the pattern to copy:
```ts
    if (transient(out.status)) return { id, status: "queued", note: `fal result HTTP ${out.status}; poll again.` };
```

`worker/fal.ts:76-92` (inside `submit`)
```ts
    const q = (await res.json()) as { request_id: string; status_url: string; response_url: string };
    accepted = true;
    await settle(env, spendId, true);
    await env.DB.prepare(`INSERT INTO renders (...) VALUES (...)`).bind(...).run();
    return { id, usdEstimate: usd, status: "queued" as const };
  } catch (e) {
    if (!accepted) await settle(env, spendId, false);
    throw e;
  }
```

`worker/batch.ts:285-303`
```ts
  // Claim the pick before the paid call, so two taps (or a retry) cannot start two finals.
  const claim = `pending:${crypto.randomUUID()}`;
  const claimed = await env.DB.prepare("UPDATE picks SET final_render_id = ? WHERE render_key = ? AND final_render_id IS NULL")
    .bind(claim, key)
    .run();
  if (claimed.meta.changes !== 1) return { id: null, status: "already started" };
  ...
  try {
    r = await fal.submit(env, { batch: batchId, idea: pick.idea_id, kind: "final", ... });
  } catch (e) {
    // fal did not take the job: free the pick so the owner can tap Render again.
    await env.DB.prepare("UPDATE picks SET final_render_id = NULL WHERE render_key = ? AND final_render_id = ?").bind(key, claim).run();
    throw e;
  }
```
Line 283, before the claim: `if (pick.final_render_id) return { id: pick.final_render_id, status: "already started" };`

`worker/api.ts:30-39` (the pattern for a claim that goes stale)
```ts
export async function claimCompose(env: Env, id: string, now = new Date()): Promise<string | null> {
  const stale = new Date(now.getTime() - 120_000).toISOString();
  const claim = `pending:${now.toISOString()}:${crypto.randomUUID()}`;
  const res = await env.DB.prepare(
    `UPDATE renders SET composed_key = ? WHERE id = ?
     AND (composed_key IS NULL OR (composed_key LIKE 'pending:%' AND composed_key < ?))`,
  ).bind(claim, id, `pending:${stale}`).run();
  return res.meta.changes === 1 ? claim : null;
}
```

`worker/mcp.ts:853-860` (compose_final)
```ts
        const brand = await brandBySlug(env, a.brandSlug);
        const pinned = await env.DB.prepare(
          "SELECT b.kit_version FROM renders r JOIN batches b ON b.id = r.batch WHERE r.id = ? AND b.brand_id = ?",
        )
          .bind(String(a.key).split("/")[1], brand.id)
          .first<{ kit_version: number }>();
        const kit = await latestKit(env, brand.id, pinned?.kit_version);
```
When the render is not in a batch of that brand, `pinned` is null and
`latestKit(env, brand.id, undefined)` returns the brand's newest kit.

Conventions: errors are plain `throw new Error("...")` with a sentence the
agent can act on. Comments say why, in one line. No new dependency. D1 writes
that must be atomic use a guarded `UPDATE ... WHERE` and check
`meta.changes`. Tests stub `fetch` with `vi.stubGlobal` and build the
database with `fakeD1()`.

Hard constraint: the Worker runs on the Cloudflare Free plan (10 ms CPU per
request). Add no loop over large data and no extra fetch.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Target tests | `npx vitest run tests/fal.test.ts tests/batch.test.ts tests/picks.test.ts` | all pass |
| Full check | `npm run check` | exit 0 |

## Scope

**In scope**:
- `worker/fal.ts`, `worker/batch.ts` (function `finalRender` only),
  `worker/mcp.ts` (the `compose_final` handler only)
- `tests/fal.test.ts`, `tests/batch.test.ts`
- `docs/decisions.md` (append one row)

**Out of scope**:
- `worker/spend.ts` and when a reservation is released on a timeout. That
  changes how the spend cap counts; the owner decides it (see
  `plans/README.md`).
- Validation of `render_submit` `batch` and `idea` values. The code accepts
  free-form ids on purpose (`worker/batch.ts:164`).
- `worker/api.ts`. Copy its pattern; do not change it.
- Any migration. This plan needs no new column.
- No call to the live MCP server and no paid render. All tests use fakes.

## Git workflow

- Branch from current `origin/main`: `fix/paid-render-path`.
- One commit per step is fine. Style: `fix(render): keep a finished render when one download fails`.
- PR ready (not draft). Body: Goal 2; a "Security check" line
  (`docs/security-checklist.md` run; no new route; no auth change).
- Do not merge unless the operator told you to. A merge to `main` deploys.

## Steps

### Step 1: A temporary download error keeps the render queued

Tests first, in `tests/fal.test.ts` (pattern: the test
`"marks a short download failed and keeps the saved keys"` at line 48). Add:
- an image download that answers HTTP 503 → `check` returns
  `status: "queued"`, the row in `renders` still has `status = 'queued'`.
- an image download that answers HTTP 404 → the render is `failed` as today.

Then in `worker/fal.ts`, in the image loop, replace `if (!file.ok) continue;`
with:
```ts
    if (!file.ok) {
      // A temporary error from the image host: stay queued, the next poll downloads again (R2 puts repeat safely).
      if (transient(file.status)) return { id, status: "queued", note: `image download HTTP ${file.status}; poll again.` };
      continue;
    }
```

**Verify**: `npx vitest run tests/fal.test.ts` → all pass, 2 new tests.

### Step 2: A late poll cannot overwrite a finished render

Test first: set the row to `status = 'done'` (with `image_keys`) after `check`
has read it but before it writes (stub one `fetch` so that it updates the row
through `env.DB.raw`), let the downloads fail with 404, and expect the row to
stay `done`.

In `worker/fal.ts` change the final update to
`UPDATE renders SET status = ?, image_keys = ?, error = ?, updated_at = ? WHERE id = ? AND status = 'queued'`.
When `meta.changes !== 1`, read the row again with the same SELECT as the top
of `check` and return `view(env, thatRow)`. Apply the same
`AND status = 'queued'` guard in the helper `fail` (line 166) if it writes
`status` without one.

**Verify**: `npx vitest run tests/fal.test.ts` → all pass.

### Step 3: `submit` says when fal accepted the job

In `worker/fal.ts` add and export:
```ts
/** fal took the job (it is billed) but the render row was not saved. The caller must not start the job again. */
export class AcceptedError extends Error {}
```
In `submit`, wrap only the `INSERT INTO renders` in a try block. On failure,
try the same insert once more; if it fails again, throw
`new AcceptedError(`fal accepted render ${id} (request ${q.request_id}) but the row was not saved: ${message}. Do not submit again; tell the owner.`)`.
The outer `catch` already skips the release when `accepted` is true.

Test in `tests/fal.test.ts`: stub `fetch` to accept the job, make the insert
fail (drop the `renders` table through `env.DB.raw` before the call), expect
`AcceptedError`, and expect the spend row to be `spent`
(`SELECT status FROM spend`).

**Verify**: `npx vitest run tests/fal.test.ts` → all pass.

### Step 4: The final claim goes stale, and stays after an accepted job

In `worker/batch.ts` `finalRender`:
1. Build the claim like `claimCompose`:
   `pending:${new Date().toISOString()}:${crypto.randomUUID()}`.
2. A claim older than 2 minutes is stale. Change the early return on line 283
   so that a `final_render_id` that starts with `pending:` and is older than
   the stale limit does not return; and change the claim statement to
   `UPDATE picks SET final_render_id = ? WHERE render_key = ? AND (final_render_id IS NULL OR (final_render_id LIKE 'pending:%' AND final_render_id < ?))`
   bound with `pending:<iso time 2 minutes ago>`.
3. In the `catch`, release the claim only when the error is not an
   `fal.AcceptedError`. For an `AcceptedError`, leave the claim and rethrow.

`worker/picks.ts:93` already treats any `pending:` value as "no final yet";
do not change it.

Tests in `tests/batch.test.ts` (pattern: the existing final render tests in
this file; search for `finalRender`):
- a pick with a `pending:` claim 3 minutes old → `finalRender` starts a final.
- a pick with a `pending:` claim 10 seconds old → `status: "already started"`,
  no fal call.
- fal answers HTTP 500 → the claim is released (as today).
- `fal.submit` throws `AcceptedError` → the claim stays, the error is thrown.

**Verify**: `npx vitest run tests/batch.test.ts tests/picks.test.ts` → all pass.

### Step 5: `compose_final` refuses a render of another brand

In `worker/mcp.ts`, after the `pinned` query, add:
```ts
        if (!pinned) throw new Error(`${a.key} is not a render of a batch of brand ${a.brandSlug}. Check the key and the brand.`);
```
Test in `tests/batch.test.ts` inside `describe("compose_final with brandSlug")`
(line 399): make two brands, call the tool with brand B's slug and a render
key of brand A, expect the error and no compose
(`composed_key` stays null).

**Verify**: `npx vitest run tests/batch.test.ts tests/compose.test.ts` → all pass. If an existing test composes a render that has no batch row with `brandSlug`, that is a STOP condition.

### Step 6: Record and check

Append one row to `docs/decisions.md` (date 2026-11-11; who: agent, improve
pass): the four behaviour changes above, each in one short sentence. Why:
Goal 2, a paid final is not lost, not paid twice, and carries its own brand's
logo. No hard check was added (these are state guards, not copy checks).

**Verify**: `npm run check` → exit 0.

## Test plan

New tests: 3 in `tests/fal.test.ts` steps 1-2, 1 in step 3, 4 in
`tests/batch.test.ts` step 4, 1 in step 5. Every new test must fail before its
code change and pass after it.

## Done criteria

- [ ] `grep -c "status = 'queued'" worker/fal.ts` → at least `1`
- [ ] `grep -c "AcceptedError" worker/fal.ts worker/batch.ts` → both files match
- [ ] `grep -c "is not a render of a batch of brand" worker/mcp.ts` → `1`
- [ ] `npm run check` exits 0
- [ ] `git status --short` lists only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- An existing test relies on `compose_final` with `brandSlug` for a render
  that has no batch (Phase 0 style renders). Report it; the owner must decide
  whether such renders may still be composed by slug.
- The fake D1 cannot make the insert fail in step 3 without a change to
  `tests/helpers/d1.ts`.
- Any change would add a fetch or a second D1 round trip to the normal
  (success) path of `check` or `submit`.

## Maintenance notes

- After step 3 a render can be billed with no row. The error text names the
  fal request id so a person can find it. If this ever happens in production,
  the next step is a reconcile tool; do not build it now.
- Reviewer: read the stale-claim SQL closely. String comparison of
  `pending:<ISO time>` values is what makes it work, as in `claimCompose`.
- Deferred, needs the owner: release of spend reservations on timeouts
  (`worker/fal.ts:74-91`, `worker/exa.ts`), see `plans/README.md`.
