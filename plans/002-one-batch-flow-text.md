# Plan 002: One batch flow in every text, and drafts shown in a blind order

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before you go to the
> next step. If a "STOP condition" occurs, stop and report. Do not improvise.
> When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4062fb1..HEAD -- worker/mcp.ts worker/prompts.ts worker/batch.ts app/src/views/Board.tsx docs/creative-playbook.md tests/mcp.test.ts tests/batch.test.ts`
> If an in-scope file changed, compare the "Current state" excerpts with the
> live code first. A mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4062fb1`, 2026-11-11

## Why this matters

A Claude session runs each batch from text: the MCP server instructions, the
`/a11:` prompts, the tool descriptions and the creative playbook. Today these
four texts disagree on five points, so a fresh session can do the wrong thing:

1. `batch_get` returns each idea's drafts sorted by the critic's rank. The
   owner must see drafts in image order with no rank. An agent that numbers
   drafts in the order it gets them shows its own favourite as "draft 1" every
   time. That biases the one human step and poisons the taste record.
2. Defects must be named **before** the owner picks. The server text says
   "then", and the prompts do not ask for it at all.
3. `taste_log` is read at three different moments in three texts.
4. The `render_submit` description sends agents to an admin route they cannot
   use, and its `numImages` default (3) is against the house recipe (1).
5. The idea count is "20 to 30" in one prompt and "at least 8 per stage" (24
   or more) elsewhere.

This serves Goal 1 (the owner's pick is the taste signal; it must be unbiased)
and Goal 2 (fewer defective drafts become paid finals).

## Current state

Files:
- `worker/mcp.ts` — the MCP server. Line 29-30: `const INSTRUCTIONS = "..."`
  (one long string, not exported). Line 768: the `render_submit` description.
  Line 777: `numImages: { type: "integer", minimum: 1, maximum: 3, default: 3 },`
- `worker/prompts.ts` — the 8 prompts. Line 57 is the `batch` prompt, line 76
  `redesign`, line 83 `final`.
- `worker/batch.ts` — `batchGet` (line 320 onward) builds the batch view.
- `app/src/views/Board.tsx` — the owner's pick board.
- `docs/creative-playbook.md` — the playbook. Section 5 (lines 50-55) is the
  batch process; section 7.1 (line 78) is "prompt 1".
- `tests/batch.test.ts:159-160` pins the rank order. `tests/mcp.test.ts:87-96`
  checks that prompts name only real tools.

Excerpts (read at `4062fb1`):

`worker/batch.ts:355-359`
```ts
      drafts: renders.results
        .filter((r) => r.idea === i.id && r.kind === "draft")
        .flatMap((r) => (r.image_keys ? (JSON.parse(r.image_keys) as string[]) : []))
        .map((key) => ({ ...img(key), rank: rankBy.get(key)?.rank ?? null, reason: rankBy.get(key)?.reason ?? null, picked: pickBy.has(key) }))
        .sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99)),
```
The `renders` query above it is `ORDER BY created_at`, so without the `.sort`
the drafts are already in submit order, then image order.

`app/src/views/Board.tsx:126`
```tsx
{[...idea.drafts].sort((x, y) => x.key.localeCompare(y.key, undefined, { numeric: true })).map((d) => {
```
A draft key is `renders/<random uuid>/1.jpg`. With one render per draft (the
house recipe) this sort is a random order that differs from the chat order.

`tests/batch.test.ts:159-160`
```ts
    expect(hook.drafts.map((d) => d.key)).toEqual([keys[1], keys[2], keys[0]]);
    expect(hook.drafts[0]!).toMatchObject({ rank: 1, picked: true, reason: "clean jar" });
```

`worker/mcp.ts:30` (parts of the one string):
- `... render_submit drafts (... measure each draft's shape before you show it) → taste_log (read what the owner chose before; let it steer the ideas) → drafts_rank (a blind rank: the owner does not see it before he picks) → ...`
- `... THE OWNER PICKS 1 DRAFT PER IDEA, you never pick for him (then tell him which draft has a render-checklist defect, if any) → picks_save ...`

`worker/mcp.ts:768` (inside the `render_submit` description):
`... for a closed product the product-lock skeleton only (docs/creative-playbook.md §7.4: upload it with PUT /admin/ref/<uuid>.jp...`

`worker/prompts.ts:57` (batch prompt, steps 3 to 6):
- `3. Idea burst: 20 to 30 ideas. Use the writer subagent. ...`
- `4. Drafts: for each picked idea, three separate render_submit calls with numImages 1 and a product-lock skeleton each (creative-playbook §7.4 A). Measure each draft's product shape before you show it.`
- `5. drafts_rank blind, with one reason per draft that names what you see. ...`
- `6. STOP. Show the owner the drafts (one picture per idea, 3 drafts left to right, no rank) or point him to the board, and wait. ...`

`worker/prompts.ts:76` (redesign): step 5 says `24 to 30 ideas, at least 8 per funnel stage`; steps 6 to 8 match batch steps 4 to 6.

`worker/prompts.ts:83` (final, step 1): `... Add one line with his words to the batch notes (batch_update notes), ...`
`worker/batch.ts:104`: `if (input.notes !== undefined) (sets.push("notes = ?"), args.push(input.notes));` — the whole field is replaced.

`docs/creative-playbook.md:55` (section 5 step 6) has the correct rule:
"read `taste_log` first. Then rank the drafts blind ... Show the owner the
drafts: one picture per idea with its 3 drafts numbered 1, 2, 3 from left to
right in image order, and no rank. Name any draft that has a D item and tell
him not to pick it."

`docs/creative-playbook.md:78`: `1. **Draft** (render_submit kind draft, 3 images, low; references: the packshot only):`
`docs/creative-playbook.md:50`: `... and the Ad Library through Apify (the oldest active statics in the category ...`

Conventions: prompts and descriptions are plain strings in Simplified
Technical English, British spelling, short sentences. The owner is "he".
Tool names are written bare (`taste_log`). Where two prompts share steps, the
steps are written in both (`worker/prompts.ts:5`). The agent uploads a
reference picture with the MCP tool `upload_link` (kind `ref`) and the `curl`
command it returns; agents never hold the admin token.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| One test file | `npx vitest run tests/batch.test.ts` | all pass |
| Full check | `npm run check` | exit 0 |

## Scope

**In scope**:
- `worker/batch.ts` (the `.sort` on line 359 only)
- `app/src/views/Board.tsx` (line 126 only)
- `worker/mcp.ts` (the `INSTRUCTIONS` string; add `export`; the
  `render_submit` description and its `numImages` default; the `batch_update`
  description)
- `worker/prompts.ts` (lines 57, 76, 83 only)
- `docs/creative-playbook.md` (lines 50 and 78 only)
- `tests/batch.test.ts`, `tests/mcp.test.ts`
- `docs/decisions.md` (append one row)

**Out of scope**:
- `worker/fal.ts` and the paid render path (plan 003).
- `plugin/commands/*.md` and `plugin/agents/*.md`: tests pin their text; the
  commands only call `prompt_get`.
- Any new tool, column or migration. Do not add an `appendNote` input.
- `drafts_rank` behaviour and the `rank` and `reason` fields: they stay in the
  `batch_get` result. Only the order changes.

## Git workflow

- Branch from current `origin/main`: `fix/blind-draft-order-flow-text`.
- Commit style: `fix(batch): show drafts in image order; align the flow text`.
- PR ready (not draft). Body: Goal 1; a "Security check" line
  (`docs/security-checklist.md` run; no route, auth or data change).
- Do not merge unless the operator told you to. A merge to `main` deploys.

## Steps

### Step 1: Failing test first

In `tests/batch.test.ts:159-160` change the expectation to submit order:
`[keys[0], keys[1], keys[2]]`, and find the ranked draft by key instead of by
position (`hook.drafts.find((d) => d.rank === 1)` matches
`{ picked: true, reason: "clean jar" }`).

**Verify**: `npx vitest run tests/batch.test.ts` → exactly this test fails.

### Step 2: Remove the rank sort; the board keeps the server order

- `worker/batch.ts:359`: delete the `.sort(...)` line. Add a one-line comment
  above `drafts:`: `// Submit order, then image order. Never rank order: the owner sees the drafts blind.`
- `app/src/views/Board.tsx:126`: replace
  `[...idea.drafts].sort((x, y) => x.key.localeCompare(y.key, undefined, { numeric: true })).map(`
  with `idea.drafts.map(`.

**Verify**: `npx vitest run tests/batch.test.ts` → all pass. `npm run typecheck` → exit 0.

### Step 3: INSTRUCTIONS

In `worker/mcp.ts:29` change `const INSTRUCTIONS` to `export const INSTRUCTIONS`.
In the string:
- Replace `→ taste_log (read what the owner chose before; let it steer the ideas) → drafts_rank` with
  `→ taste_log again (before you rank: see where he chose against your rank 1) → drafts_rank`.
- Replace `(then tell him which draft has a render-checklist defect, if any)` with nothing, and
  insert before `STOP and show the owner the drafts`:
  `name every draft that has a render-checklist D item (D1 to D9) and tell him not to pick it → `.
- After `numbered left to right, in image order, no rank` add
  `(batch_get lists drafts in that order)`.

**Verify**: `grep -c "then tell him which draft" worker/mcp.ts` → `0`.

### Step 4: render_submit description and default

- In the description (line 768) replace the words
  `upload it with PUT /admin/ref/<uuid>.jpg, then use https://<worker>/m/refs/<uuid>.jpg`
  with `upload it with upload_link kind ref and the curl command it returns, then use the URL that upload_link gives`.
  Keep the rest of the sentence.
- Line 777: `default: 3` → `default: 1`. In the description change
  `up to 3 images` to `1 image by default (numImages up to 3)`.
- In the `batch_update` description add one sentence:
  `notes replaces the whole field: read batch_get first and send the old notes with the new line.`

**Verify**: `sed -n 768p worker/mcp.ts | grep -c "admin/ref"` → `0`. `tests/mcp.test.ts:186` pins the old default (`expect(validate(schema, ok).numImages).toBe(3)`): change `3` to `1`. Then `npx vitest run tests/mcp.test.ts tests/tools.test.ts` → all pass.

### Step 5: Prompts

In `worker/prompts.ts`:
- Line 57 step 3: `20 to 30 ideas` → `24 to 30 ideas, at least 8 per funnel stage`.
- Line 57 step 4 and line 76 step 6: after `a product-lock skeleton each (creative-playbook §7.4 A)` add
  ` (upload each skeleton with upload_link kind ref)`.
- Line 57 step 5 and line 76 step 7: put `Read taste_log again, then ` before `drafts_rank blind`
  (use a capital D only where the sentence starts).
- Line 57 step 6 and line 76 step 8: after `no rank)` add
  `, in the order batch_get lists them`. Before `He picks 1 draft per idea` add
  `First name every draft that has a render-checklist D item (D1 to D9) and tell him not to pick it. Do not say which draft you prefer. `
- Line 83 step 1: replace `(batch_update notes)` with
  `(batch_get for the current notes, then batch_update notes with the old notes and the new line: notes replaces the whole field)`.

**Verify**: `npx vitest run tests/mcp.test.ts` → all pass (the tool-name test accepts `upload_link`, `batch_get`, `taste_log`).

### Step 6: Playbook

- `docs/creative-playbook.md:78`: `1. **Draft** (render_submit kind draft, 3 images, low; references: the packshot only):`
  → keep the item, and add at its start:
  `Fallback only, for a product state the packshot cannot show (§5 step 5). The normal draft is one render per draft from a product-lock skeleton (§7.4).`
- `docs/creative-playbook.md:50`: after `the Ad Library through Apify` add
  ` (Phase 4, not built: a paid step, ask the owner first)`.

**Verify**: `grep -c "Fallback only" docs/creative-playbook.md` → at least `1`.

### Step 7: Drift test for INSTRUCTIONS

In `tests/mcp.test.ts`, next to the test `"names only tools that exist in every prompt"` (line 87), add a test with the same pattern for `INSTRUCTIONS`:
import `INSTRUCTIONS` from `../worker/mcp`, collect every `\b([a-z]+_[a-z_]+)\b`
match, allow the script name `box_print`, and expect no name outside
`TOOLS.map((t) => t.name)`. Also assert that the string contains
`in image order` and does not contain `then tell him`.

**Verify**: `npx vitest run tests/mcp.test.ts` → all pass, 1 new test.

### Step 8: Record and check

Append one row to `docs/decisions.md` (date 2026-11-11; who: agent, improve
pass): `batch_get` and the board list drafts in submit order, never rank
order; defects are named before the pick; `render_submit` defaults to 1 image;
one idea count (24 to 30). Why: Goal 1, an unbiased owner pick.

**Verify**: `npm run check` → exit 0.

## Test plan

- Changed: `tests/batch.test.ts` (draft order is submit order; rank found by key).
- New: `tests/mcp.test.ts` INSTRUCTIONS test (step 7).
- Pattern: `tests/mcp.test.ts:87-96`.
- `npm run check` → exit 0.

## Done criteria

- [ ] `grep -c "rank ?? 99" worker/batch.ts` → `0`
- [ ] `grep -c "localeCompare" app/src/views/Board.tsx` → `0`
- [ ] `grep -c "20 to 30" worker/prompts.ts` → `0`
- [ ] `npm run check` exits 0
- [ ] `git status --short` lists only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- A test other than the ones named here fails after step 2, 4 or 5 and the
  fix is not a one-line expectation change.
- The board (`Board.tsx`) depends on the key sort for something other than
  display order (for example pick state by index).
- `default: 1` breaks a caller in `worker/` that relies on 3 images.

## Maintenance notes

- The flow now lives in four texts that a test only partly guards. A later
  change could cut `INSTRUCTIONS` to the hard rules plus "run prompt_get".
  That is a wording decision for the owner; it is not in this plan.
- The art-director subagent (`plugin/agents/art-director.md`) is named by no
  prompt, and the critic subagent does not rank drafts. Whether to wire them
  in or delete the art-director is a direction question, recorded in
  `plans/README.md`.
- Reviewer: check the live `tools/list` text after deploy; clients see
  `INSTRUCTIONS` only at connect time, so a session that is already open keeps
  the old text.
