# Plan 005: `pack_publish` copies approved copy by itself, so no agent retypes it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before you go to the
> next step. If a "STOP condition" occurs, stop and report. Do not improvise.
> When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4062fb1..HEAD -- worker/pack.ts worker/mcp.ts worker/prompts.ts tests/pack.test.ts tests/mcp.test.ts docs/creative-playbook.md`
> If an in-scope file changed, compare the "Current state" excerpts with the
> live code first. A mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (additive input; the old input still works)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4062fb1`, 2026-11-11

## Why this matters

On 2026-11-09 the owner rejected the Meta text of W47 packs v4 and v5 and
approved the old v3 text ("make sure in the future no such thing would occur
in our pipeline"). The fix then was words: the `pack` prompt now says "reuse
the copy the owner approved word for word". But `pack_publish` still takes
every text field as free input, so the copy survives only if an agent retypes
about 12 strings with no error. A missing `launchPlan` is silently replaced
with the default plan. This plan lets the server copy the approved text from
an earlier pack version, so reuse is exact by construction. It serves Goal 1
(human-directed copy) and Goal 2 (the copy the client pays for).

## Current state

Files:
- `worker/pack.ts` — `packPublish` (line 82), `packUpdate` (line 191),
  `adKey` (matches ads of two packs by stage and idea number), `PackAd`
  (line 17), `PackContent` (line 29), `DEFAULT_LAUNCH_PLAN` (line 37).
- `worker/mcp.ts` — tool `pack_publish` (line 688): description and
  `inputSchema`.
- `worker/prompts.ts:90` — the `pack` prompt, step 4.
- `tests/pack.test.ts` — `describe("pack_publish")` (line 70) and
  `describe("pack_update")` (line 192); helpers `publish(...)` and `copy()`.

Excerpts (read at `4062fb1`):

`worker/mcp.ts:699-714` (`pack_publish` input, per ad)
```ts
              renderId: { type: "string", pattern: "^[0-9a-f-]{36}$" },
              primaryTexts: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", minLength: 10, maxLength: 600, pattern: "\\S" } },
              headlines: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", minLength: 3, maxLength: 40, pattern: "\\S" } },
              description: { type: "string", minLength: 3, maxLength: 30, pattern: "\\S" },
              cta: { type: "string", enum: [...pack.CTAS] },
              why: { type: "string", minLength: 10, maxLength: 300, pattern: "\\S", description: "One line: the buyer truth and its source." },
            },
            required: ["renderId", "primaryTexts", "headlines", "description", "cta", "why"],
            additionalProperties: false,
  ...
        launchPlan: { type: "string", minLength: 20, maxLength: 1200, pattern: "\\S", description: "Replaces the default plan (one ad set, 72 hours, pause ads below the client's CTR)." },
```

`worker/pack.ts:82-85`
```ts
export async function packPublish(
  env: Env,
  a: { batchId: string; ads: PackAdInput[]; launchPlan?: string; healthProduct?: boolean; at?: Date },
) {
```

`worker/pack.ts:112-118` (the number check, hard check 1; it must still run)
```ts
    const texts = [...ad.primaryTexts, ...ad.headlines, ad.description];
    for (const n of new Set(texts.flatMap(numbersIn))) {
      const f = facts.find((x) => numbersIn(`${x.value} ${x.quote}`).includes(n));
      if (!f) throw new InputError(`The number ${n} in the copy for "${r.headline}" is not in the fact sheet. Add the fact with its source (facts_save) or remove the number.`);
```

`worker/pack.ts:134`: `launchPlan: a.launchPlan?.trim() || DEFAULT_LAUNCH_PLAN,`

`worker/pack.ts` in `packUpdate` (how two packs' ads are matched):
```ts
  const byKey = new Map(src.ads.map((x) => [adKey(x.name), x]));
  const missing = old.ads.filter((x) => !byKey.has(adKey(x.name))).map((x) => x.name);
```
and how one pack version is read:
```ts
    env.DB.prepare("SELECT id, version, content, revoked_at FROM packs WHERE batch_id = ? AND version = ?")
```

In `packPublish` each ad's row gives its stage and idea number
(`r.format`, `r.n`). Ad names look like `a11_W46_wongi_b02_tof_c03_v1`; packs
made before 07-11-2026 have no `b02` part, and `adKey` handles both.

`worker/prompts.ts:90`, step 4, starts: `4. The Meta text. When picks_get lists an earlier pack of this batch, reuse the copy the owner approved (the pack he named or commented on; ask him which when it is not clear) word for word: primary texts, headlines, description, button, why and launch plan. Never rewrite approved copy on your own, ...`

Conventions: input errors are `throw new InputError("sentence the agent can
act on")`. The schema validator is the repo's own (`worker/schema.ts`); it
supports `type`, `required`, `enum`, `pattern`, `minItems`, `default` and
`additionalProperties`. Check that file before you use any other keyword.
Text is Simplified Technical English, British spelling.

Rule budget: the repo allows at most 15 hard checks in code and each new one
needs a failure as its test fixture. This plan adds no new check on copy
content. It adds a copy function. The fixture is the 2026-11-09 incident.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Target tests | `npx vitest run tests/pack.test.ts tests/mcp.test.ts tests/tools.test.ts` | all pass |
| Full check | `npm run check` | exit 0 |

## Scope

**In scope**:
- `worker/pack.ts` (`packPublish` and its input type)
- `worker/mcp.ts` (the `pack_publish` tool only)
- `worker/prompts.ts` (line 90, step 4 and step 5 only)
- `tests/pack.test.ts`
- `docs/creative-playbook.md` section 8 (one sentence), `docs/decisions.md`
  (append one row)
- `plans/README.md` (the status row of this plan only)

**Out of scope**:
- `packUpdate`, `pack_revoke`, the portal. No change.
- Any migration or new column (for example an "approved" flag on packs). Which
  version the owner approved stays his word in the chat; see
  `plans/README.md` for that open decision.
- Do not publish, update or revoke any live pack. Tests use the fake D1 only.
  W47 packs v1 to v5 must stay exactly as they are.

## Git workflow

- Branch from current `origin/main`: `feat/pack-copy-from-version`.
- Commit style: `feat(pack): pack_publish copies the approved copy from an earlier version`.
- PR ready (not draft). Body: Goals 1 and 2; a "Security check" line (no new
  route; input is validated; text still passes the number check).
- Do not merge unless the operator told you to. A merge to `main` deploys.

## Steps

### Step 1: Tests first

In `tests/pack.test.ts`, inside `describe("pack_publish")`, add tests (use the
existing `publish` and `copy()` helpers as the pattern):
1. Publish v1 with texts and a custom `launchPlan`. Publish again with
   `copyFromVersion: 1` and ads that give only `renderId`. Expect the new
   pack's `primaryTexts`, `headlines`, `description`, `cta`, `why` and
   `launchPlan` to equal v1's, string for string, and the ad names to carry
   the new version.
2. `copyFromVersion` with an ad that also gives a text field → `InputError`
   that says to give either the text or `copyFromVersion` for an ad, not both.
3. `copyFromVersion` of a version that does not exist → `InputError`.
4. `copyFromVersion` when the source pack has no ad for one of the ideas →
   `InputError` that names the idea's stage and number.
5. No `copyFromVersion` and an ad without texts → `InputError` (texts are
   still required then).
7. `copyFromVersion` of a revoked pack → `InputError`, nothing published.
8. The source pack has a health note and the call gives no `healthProduct` →
   the new pack has the same `healthNote`.
6. The copied text still runs the number check: remove a fact from the fake
   database after v1, publish with `copyFromVersion: 1`, expect the "not in
   the fact sheet" error.

**Verify**: `npx vitest run tests/pack.test.ts` → the 8 new tests fail, the old tests pass.

### Step 2: `packPublish`

- Add `copyFromVersion?: number` to the input type. Make the text fields of
  `PackAdInput` optional in the type.
- When `copyFromVersion` is set: read that pack row of this batch (same SELECT
  as `packUpdate`). Refuse a revoked source with an `InputError`, as
  `packUpdate` does. Parse its content, and
  build `byKey` with `adKey` as `packUpdate` does.
- In the per-ad loop, after `r` is read: if the ad input has no text fields,
  take them from the source ad whose key matches this ad's stage and idea
  number (build the key the same way `adKey` reads it; reuse `adKey` on a name
  made with `adName(week, b.slug, batchNo, r.format, r.n, 0)` if that is the
  simplest exact match). If the ad input has any text field while
  `copyFromVersion` is set, throw the `InputError` of test 2. Without
  `copyFromVersion`, a missing text field throws the `InputError` of test 5.
- Launch plan: with `copyFromVersion` and no `launchPlan` input, use the
  source pack's `launchPlan`. Otherwise keep line 134 as it is.
- Health note: with `copyFromVersion` and no `healthProduct` input, keep the
  source pack's `healthNote` (a health product must not lose its HSA and Meta
  note). An explicit `healthProduct` input wins. Check how the schema default
  (`healthProduct` `default: false`) reaches `packPublish`: the server must be
  able to tell "not given" from `false`; remove the schema default if needed
  and apply it in code.
- Leave the number check where it is, so it runs on copied text too.
- Add `copiedFromVersion` to the result object when it was used.

**Verify**: `npx vitest run tests/pack.test.ts` → all pass.

### Step 3: Tool schema and description

In `worker/mcp.ts` `pack_publish`:
- Add `copyFromVersion: { type: "integer", minimum: 1, description: "Take the Meta text, why and launch plan word for word from this earlier pack version of the batch (the one the owner approved). Then give only renderId for each ad." }`.
- Change the per-ad `required` to `["renderId"]`. The server checks the rest
  (step 2).
- Add one sentence to the description:
  `To reuse approved copy, give copyFromVersion and no text: the server copies it exactly.`

Check `tests/pack.test.ts` test `"checks the tool input: two texts, headline 40 characters at most, a known button"` (line 114): keep it passing. If it expects a schema error for a missing text field, change that expectation to the server `InputError` from step 2.

**Verify**: `npx vitest run tests/pack.test.ts tests/mcp.test.ts tests/tools.test.ts` → all pass.

### Step 4: Prompt and playbook

- `worker/prompts.ts:90` step 4: after `word for word: primary texts, headlines, description, button, why and launch plan.` add
  ` Do not retype it: give pack_publish copyFromVersion (that pack's version) and only the render ids.`
- `docs/creative-playbook.md` section 8 (the copy standard): add the same
  rule in one sentence.

**Verify**: `npx vitest run tests/mcp.test.ts` → all pass (the prompt tests read this text).

### Step 5: Record and check

Append one row to `docs/decisions.md` (date 2026-11-11; who: agent, improve
pass; fixture: the 2026-11-09 copy incident): `pack_publish` takes
`copyFromVersion`; approved copy is copied by the server, not retyped. Why:
Goals 1 and 2.

**Verify**: `npm run check` → exit 0.

## Test plan

8 new tests in `tests/pack.test.ts` (step 1). Pattern: the existing
`pack_publish` tests in the same `describe`.

## Done criteria

- [ ] `grep -c "copyFromVersion" worker/pack.ts worker/mcp.ts worker/prompts.ts` → all three files match
- [ ] `npx vitest run tests/pack.test.ts` → all pass, 8 new
- [ ] `npm run check` exits 0
- [ ] `git status --short` lists only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- `adKey` cannot match a new ad to an old pack's ad without a real ad name,
  and the simple route in step 2 does not give an exact match in a test with
  an old-style name (no batch number).
- The schema validator cannot express optional text fields without a change
  to `worker/schema.ts`.
- Any step would change what an existing pack shows.

## Maintenance notes

- This closes the retyping gap only. It does not record which version the
  owner approved. If the owner wants that as data (an "approved" mark per
  pack), it needs a migration and his yes; see `plans/README.md`.
- Reviewer: check that a pack published with `copyFromVersion` is
  byte-identical in its text fields to the source in the test, and that the
  fact check list is rebuilt from the current fact sheet.
