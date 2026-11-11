# Plan 006 (design): Every owner verdict is saved as data that `learn` reads

> **Executor instructions**: This is a design plan. Its output is one design
> document and no code. Follow the steps in order. If a "STOP condition"
> occurs, stop and report. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4062fb1..HEAD -- worker/batch.ts worker/prompts.ts worker/canon.ts migrations/ docs/marks.md`
> If these changed, read them again before you write the design.

## Status

- **Priority**: P2
- **Effort**: S for this design; M for the build that follows
- **Risk**: LOW
- **Depends on**: none. The build that follows needs the owner's yes (a live
  D1 migration).
- **Category**: direction
- **Planned at**: commit `4062fb1`, 2026-11-11

## Why this matters

Goal 1 is a tool that learns the owner's taste. Today the tool keeps only one
kind of verdict: the draft he picked, with his words (`picks`). His other
verdicts are lost unless the same chat session still holds them:

- his notes on a final ("the print on the box looks pasted"),
- a pass on all 3 drafts of an idea (the strongest "no"),
- his approval or rejection of pack copy,
- his own comments on a pack link.

`docs/marks.md` shows the cost: the owner's notes on the Phase 0 and W46c finals (14 rows) were
written into markdown by hand, and they drove most of the playbook section 7.4 changes.
The `learn` command promises to turn "picks and notes" into canon changes,
but it reads only picks. This design decides how a verdict is stored and read
back, so the build is small and the owner can say yes or no to one clear
proposal.

## Current state

Facts (read at `4062fb1`):

- `worker/batch.ts:244-275` `tasteLog`: reads `picks WHERE by_owner = 1`
  with the idea, the batch label and the critic's ranks. Nothing else.
- `worker/prompts.ts:83` (`final` prompt): step 1 writes a full pass as one
  line into the batch notes (`batch_update notes`, which replaces the whole
  field: `worker/batch.ts:104`). Step 7: "When he gives notes, run taste_log
  and tell him to type /a11:learn". `taste_log` only reads, so the notes are
  saved nowhere.
- `worker/prompts.ts:97` (`learn` prompt): step 1 reads `taste_log` and
  `canon_get` only. It does not read batch notes, `comments_get` or
  `docs/marks.md`.
- `plugin/commands/learn.md:2`: "Turn the owner's new picks and notes into
  canon changes".
- `docs/creative-playbook.md:55`: a pass on all 3 drafts goes into the batch
  notes "because `taste_log` keeps only ideas where he picked a draft".
- `docs/marks.md:9-20`: the hand-kept list of the owner's notes on finals.
- `worker/canon.ts`: `canon_update` takes `evidence` with the owner's exact
  quote; rules are plain words, never patterns.
- Migrations are numbered files in `migrations/` (latest
  `0013_pack_updates.sql`). `tests/helpers/d1.ts` applies all of them for
  every test. A live migration is applied by hand and needs the owner's yes
  (`docs/deploy.md`). Workers Builds deploys new code on merge, before any
  manual migration: so the code that reads a new table must merge after the
  migration is live, or must tolerate a missing table.
- `AGENTS.md` section 8: at most 15 hard checks in code; taste goes into the
  canon in plain words, never into regexes. D2: the owner picks drafts and
  must not get more manual steps. Race, ethnicity and religion never go into
  copy.
- Declined by the owner (`docs/backlog.md`): a studio reply under each client
  comment. Do not design anything that answers comments.

## Scope

**In scope** (create only): `docs/design/owner-verdicts.md`.

**Out of scope**: all code, all migrations, every other doc except the status
row of this plan in `plans/README.md`, any MCP call
that writes. Do not start Phase 3 or Phase 4 work. Learning from real client
results is a separate backlog item and is not part of this design.

## Git workflow

- Branch from current `origin/main`: `docs/owner-verdicts-design`.
- Commit style: `docs(design): how the owner's verdicts are saved and read back`.
- PR ready (not draft). Body: Goal 1; "Security check: docs only".
- Do not merge unless the operator told you to.

## Steps

### Step 1: List the verdict kinds from real evidence

Read `docs/marks.md`, the 2026-11-07 to 2026-11-09 rows of
`docs/decisions.md`, and the `final`, `pack` and `learn` prompts in
`worker/prompts.ts`. Make a table: verdict kind, where the owner gives it
today, where it is stored today (or "nowhere"), one real quoted example from
the docs. Do not invent a quote.

**Verify**: the table has at least these rows: draft pick, full pass on an
idea, note on a final, approval of finals, pack copy approved or rejected.

### Step 2: Design the smallest store

Write one proposal, and one alternative you rejected with the reason.
The proposal must answer:

1. Storage: one new table (name it `verdicts`) with a bounded, indexed read
   path. Give the exact `CREATE TABLE` and `CREATE INDEX` text. Columns must
   cover: batch, idea (optional), render key (optional), pack id or pack
   version (optional; required for a verdict on pack copy, because one batch
   has several pack versions), stage of work
   (`draft`, `final`, `pack`), mark (`pass`, `fix`, `approve`, `reject`), the
   owner's exact words, created time. Explain why `picks` is not extended
   instead (or choose that, if it is simpler, and say why).
2. Write path: which existing tool gets one new optional input, or whether one
   new tool is needed. Prefer no new tool. The agent saves the owner's words
   only when he said them; it never writes a verdict for him.
3. Read path: `taste_log` returns verdicts next to picks, newest first, with a
   limit. Give the result shape.
4. Prompt changes: the exact new sentences for `final` step 1 and step 7,
   `pack` step 4, and `learn` step 1.
5. Backfill: how every row of `docs/marks.md` (14 dated rows on 2026-11-11; count
   them again) enters the table once (a script
   or a one-time tool call), and that `docs/marks.md` then stays as history.
6. Deploy order: migration live first (owner's yes), then the code. State the
   test for each part.
7. What this does not do: no automatic canon change, no regex on his words, no
   reply to client comments.

**Verify**: `grep -c "CREATE TABLE verdicts" docs/design/owner-verdicts.md` → `1`.

### Step 3: Size the build and name the owner's decision

End the document with: the files the build touches, the number of new tests,
an effort estimate (S/M/L), and one yes/no question for the owner in his
report style (result first, 2 to 5 short lines, one recommendation).

**Verify**: the document ends with one question that can be answered "yes" or "no".

## Done criteria

- [ ] `docs/design/owner-verdicts.md` exists and holds the 7 answers of step 2
- [ ] `git status --short` lists only that file and `plans/README.md`
- [ ] No code changed: `git diff --stat origin/main -- worker migrations tests` is empty

## STOP conditions

- The evidence in step 1 shows that verdicts are already stored somewhere this
  plan did not find.
- The smallest design needs more than one new table or more than one new tool.
  Report the reason instead of growing the design.

## Maintenance notes

- A second direction item builds on this one: a gold test made from the
  owner's own draft picks (which of 3 drafts he chose), so the critic is
  scored on the judgement the pipeline now depends on. It is recorded in
  `plans/README.md` and needs this store or the `picks` table as its source.
