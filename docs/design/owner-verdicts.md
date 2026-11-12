# Design: every owner verdict is saved as data that `learn` reads

This document uses ASD-STE100 Simplified Technical English with British spelling.

Status: built (plan `plans/006-save-owner-verdicts-design.md`, written 2026-11-12 at commit `48c65f2`). The owner approved the build on 2026-11-12. Step A (PR #72) is merged and step B is done: migration 0014 is on the live database since 2026-11-12. Do not run it again. Step C (PR #73) is merged. Step D is done: the backfill ran once on the live database on 2026-11-12 and gave 21 rows; a second run added none. Do not run it again.

Goal 1: the tool learns the owner's taste. Today it keeps one kind of verdict (the draft he picked). This design keeps the others.

## 1. The verdict kinds today

| Verdict kind | Where the owner gives it | Where it is stored today | Real example (quoted from the docs) |
|---|---|---|---|
| Draft pick | In chat or on the board, 1 of 3 drafts for each idea | `picks` (`note` holds his words, `by_owner` 1). `taste_log` reads it. | "food seems ai slop not true to actual real life product and the product's container doesn't match real life too, the dimensions height and width" (`docs/marks.md`, W46c tof) |
| Full pass on an idea (no to all 3 drafts) | In chat, at the `final` prompt step 1 | One line in the batch notes (`batch_update notes`). `taste_log` and `learn` do not read it. | No example is in the docs. |
| Note on a final | In chat, at the `final` prompt step 7 | Nowhere in the database. By hand in `docs/marks.md`. | "the mof's jar container needs more blending into the surroundings, dealing with shadows and lighting and what not ... it looks pasted in" (`docs/marks.md`, W46c v7 set) |
| Approval of finals | In chat | Nowhere in the database. By hand in `docs/decisions.md`. | "yes looks so so much better" (`docs/decisions.md`, 2026-11-09, W47 box-printed finals) |
| Rejection of a final or a set | In chat | Nowhere in the database. By hand in `docs/marks.md`. | "even worse now. the v10 looks much better to me, revert back to v10 way of doings things." (`docs/marks.md`, W46c v11 set) |
| Pack copy approved or rejected | In chat | Nowhere in the database. By hand in `docs/decisions.md`. | "the previously v3 copywriting's much much much better and i approve of it" (`docs/decisions.md`, 2026-11-09) |
| The owner's own comment on a pack link | The pack page | `comments` (by pack). The table does not record who wrote a comment. | Not quoted in the docs (W47 v3 holds 2 comments). |

No other store of verdicts was found. The plan's STOP condition does not apply.

## 2. The proposal

One new table, `verdicts`. One new optional input on one existing tool. No new tool.

### 2.1 Storage

```sql
-- Migration 0014_verdicts.sql, as merged and applied to the live database on 12-11-2026
-- One row for each thing the owner said about a draft, a final or pack copy (docs/design/owner-verdicts.md).
-- A draft pick stays in picks. Rows are only added, never changed.
CREATE TABLE verdicts (
  id TEXT PRIMARY KEY NOT NULL,           -- a UUID; the backfill uses fixed ids, so a second run adds nothing
  batch_id TEXT REFERENCES batches(id),   -- NULL only for an ad that was made in no batch (the Phase 0 ads)
  idea_id TEXT,                           -- the idea, when the verdict is about one idea (it must be an idea of batch_id)
  render_key TEXT,                        -- the draft or final picture, when the verdict is about one picture
  pack_id TEXT REFERENCES packs(id),      -- the pack version, for a verdict on the copy of a published pack
  stage TEXT NOT NULL CHECK (stage IN ('draft', 'final', 'pack')),
  mark TEXT CHECK (mark IN ('pass', 'fix', 'approve', 'reject')),
  source_mark TEXT,                       -- backfill only: the Mark cell of docs/marks.md, as written
  owner_said TEXT NOT NULL CHECK (length(owner_said) BETWEEN 1 AND 2000),
  notes TEXT,                             -- evidence that is not his words: a measured ratio, a version label
  created_at TEXT NOT NULL,
  CHECK (mark IS NOT NULL OR source_mark IS NOT NULL),
  -- Each stage has its own marks: 'pass' is only for the 3 drafts of an idea, 'approve' and 'reject' are not for a draft.
  CHECK (mark IS NULL
    OR (stage = 'draft' AND mark IN ('pass', 'fix'))
    OR (stage IN ('final', 'pack') AND mark IN ('fix', 'approve', 'reject'))),
  CHECK (stage <> 'pack' OR batch_id IS NOT NULL),
  CHECK (stage <> 'draft' OR idea_id IS NOT NULL),               -- a draft verdict is about the drafts of one idea
  CHECK (idea_id IS NULL OR batch_id IS NOT NULL),               -- so the composite key below always applies
  FOREIGN KEY (idea_id, batch_id) REFERENCES ideas(id, batch_id)   -- the same composite key as picks and draft_ranks
);
-- packs has no unique (id, batch_id) pair for a composite key, so a trigger keeps a pack verdict on a pack of its own batch.
CREATE TRIGGER verdicts_pack_of_batch BEFORE INSERT ON verdicts
WHEN NEW.pack_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM packs WHERE id = NEW.pack_id AND batch_id = NEW.batch_id)
BEGIN
  SELECT RAISE(ABORT, 'verdicts: the pack is not a pack of this batch');
END;
CREATE INDEX verdicts_recent ON verdicts (created_at);
CREATE INDEX verdicts_batch ON verdicts (batch_id, created_at);
```

`packs` has no unique `(id, batch_id)` pair, so the table cannot hold a composite key for the pack. The trigger `verdicts_pack_of_batch` refuses a pack of another batch, and the code also checks it (2.2), as it does for `render_key`.

The four marks:

| Mark | Meaning |
|---|---|
| `pass` | He chose none of it (a full pass on the 3 drafts of an idea). Stage `draft` only. |
| `fix` | He keeps it and asks for a change. All stages. |
| `approve` | He approves it as it is. Stages `final` and `pack`. |
| `reject` | He refuses it. Stages `final` and `pack`. |

Why `picks` is not extended: a `picks` row is one chosen draft. Its key is the draft's picture, and each row starts one paid final (`final_render_id`). A full pass has no chosen draft. A verdict on pack copy has no picture. A final can get many notes. A second kind of row in `picks` would put the paid-final guard at risk.

Bounded read path: `taste_log` reads `ORDER BY created_at DESC LIMIT ?` on the `verdicts_recent` index. The limit is the tool's `limit` (1 to 100, default 30).

### 2.2 Write path

`batch_update` gets one new optional input, `ownerVerdicts` (at most 20 for each call):

```json
{ "stage": "draft | final | pack", "mark": "pass | fix | approve | reject",
  "ownerSaid": "his exact words (1 to 600 characters)",
  "ideaId": "optional", "key": "optional render key", "packVersion": "optional integer",
  "notes": "optional, at most 600 characters" }
```

Rules in code:

- `ideaId` must be an idea of this batch. `key` must be a render of this batch. `packVersion` must be a pack of this batch.
- The mark must be a mark of the stage (the table in 2.1). The database refuses a wrong pair too.
- Stage `draft` needs `ideaId`. Stage `final` needs `key` (the final picture). Stage `pack` takes `packVersion` when the pack is published; without it the verdict is about the copy that was shown for this batch before a pack existed.
- The tool only adds rows. It does not change or delete a row. To correct a verdict, save a new one. The newest verdict about a picture (or, with no picture, about an idea and stage, or a pack version) is his current view; the `learn` prompt says so.
- The tool description says: save the owner's words only when he said them; never write a verdict for him. This is the same rule as `picks_save` (`ownerSaid`).

`batch_update` is the tool that takes the full-pass line today, and every verdict belongs to one batch. Thus no new tool is necessary.

The first pack of a batch: the owner approves the copy before `pack_publish` makes version 1. The `pack` prompt saves that approval after `pack_publish`, with the new version. Copy that he rejects before a pack exists is saved with no `packVersion`.

### 2.3 Read path

`taste_log` returns a new field `verdicts` next to `picks`, newest first, with the same limit:

```json
{
  "tally": { },
  "picks": [ ],
  "verdicts": [
    { "at": "2026-11-12T03:10:00.000Z", "batch": "W47 Cat & the Fiddle Fickle Feline 2.0",
      "stage": "final", "mark": "fix", "sourceMark": null,
      "ownerSaid": "his exact words", "notes": null,
      "idea": { "stage": "mof", "headline": "..." }, "key": "renders/<uuid>/1.jpg", "packVersion": null }
  ]
}
```

`idea` is null when the verdict has no idea. `batch` is null for an ad that was made in no batch.

### 2.4 Prompt changes (exact new sentences)

| Prompt | New text |
|---|---|
| `final` step 1 | "If he passed on all 3 drafts of an idea, make no pick for it. Save his words with batch_update ownerVerdicts (stage 'draft', mark 'pass', the ideaId, ownerSaid = his exact words), make 3 new drafts for that idea (new skeletons, one render_submit each), rank them blind, show him the new drafts and wait. Go on below only with ideas that have a pick." |
| `final` step 7 | "Show the owner the finals (the repaired pictures for a boxed product). Each time he says something about a final, save it at once with batch_update ownerVerdicts (stage 'final', key = that final, mark 'fix' when he asks for a change, 'reject' when he refuses it, 'approve' when he approves it, ownerSaid = his exact words). Save only what he said. When he gave notes, tell him to type /a11:learn. When he approves the finals, tell him to type /a11:pack." |
| `pack` step 4 (one sentence added at the end) | "Each time he approves, rejects or asks for a change to pack copy, save it with batch_update ownerVerdicts (stage 'pack', mark 'approve', 'reject' or 'fix', ownerSaid = his exact words; packVersion = the pack version when one exists). When he approved copy before the pack existed, save the approval after pack_publish, with the new version." |
| `learn` step 1 | "taste_log (his picks, and his verdicts: full passes, notes on finals, approvals and pack copy, each with his exact words; when two verdicts are about the same picture, the newest is his current view) and canon_get." |

The `final` prompt changes on top of the text that is on `main` at build time (the art-director wiring changes the same step). `docs/creative-playbook.md` step 6, `plugin/commands/learn.md` and `AGENTS.md` decision D2 get the same facts: the sentence "A pass on all 3 drafts goes in the batch notes" becomes "A pass on all 3 drafts, a note on a final and a verdict on pack copy go in `verdicts`, and `taste_log` returns them".

### 2.5 Backfill (once)

`docs/marks.md` stays as history. A header line says that new verdicts go to the database.

Source: 14 dated rows (counted on 2026-11-12). Result: 21 `verdicts` rows from 11 of them. A row for one ad gives one verdict row. A row for a set (tof, mof, bof) gives three. Rows 3 to 5 are not imported: they are the W46c draft picks, and `picks.note` holds the same words already (read from the live database on 2026-11-12, read-only), so `taste_log` would show them twice.

| # | Source row | Verdict rows | Stage | Mark (source mark is kept on every row) |
|---|---|---|---|---|
| 1 | P0 WonGi Pop Barley, Hook | 1 | `final` | "Usable" → `fix` (his words name a logo fault and a food fault) |
| 2 | P0 WonGi, version B | 1 | `final` | "Usable, preferred over A" → `approve` |
| 3 to 5 | W46c tof, mof, bof (draft picks) | 0 | | Not imported. The pick and his words are in `picks` already. |
| 6 | W46c tof v2 | 1 | `final` | "Not usable, fixes asked" → `reject` |
| 7, 8 | W46c mof v2, bof v2 | 2 | `final` | "Container right, fixes asked" → `fix` |
| 9 | P0 WonGi version B again | 1 | `final` | "Corrected: not a product-truth bar" → no clear match. `mark` stays NULL; `source_mark` holds the label. |
| 10 | W46c v3 set | 3 | `final` | "Much more usable" → `fix` (he asks for a bigger logo and better food) |
| 11 | W46c v4 set | 3 | `final` | "v4 food rejected, tof height still wrong" → `reject` |
| 12 | W46c v5 set | 3 | `final` | "Logos right; tof jar and bof kernels not" → tof `fix`, bof `fix`; mof has no clear match: `mark` NULL |
| 13 | W46c v7 set | 3 | `final` | "tof good, mof looks pasted, bof kernels wrong" → tof `approve`, mof `fix`, bof `fix` |
| 14 | W46c v11 set (rejected) | 3 | `final` | "v11 worse than v10; revert" → `reject` |

Rules of the backfill:

- `owner_said` is the "Owner's words" cell, as written. For a set, each of the 3 rows holds the whole cell (built 2026-11-12: a split of his words by ad could misquote him).
- `notes` holds the version label ("v2", "v5 set") and that ad's own evidence from the "Lesson" cell (for example "height ÷ width 2.46 against the real 2.65").
- `render_key` is set when `docs/marks.md` gives a key. The set rows give no key: `render_key` stays NULL and `idea_id` is the W46c idea of that stage. The rule "stage `final` needs a key" is a rule of the tool for new verdicts; these old rows have none to give.
- `batch_id` is the W46c batch for rows 6 to 8 and 10 to 14. It is NULL for rows 1, 2 and 9: the Phase 0 renders are in no batch (read from the live database on 2026-11-12, read-only).
- `created_at` is the date in the row (2026-11-07), with the row number as the second, so the order stays.
- The import is one SQL file, `scripts/backfill-verdicts.sql`: 21 `INSERT ... ON CONFLICT(id) DO NOTHING` statements with fixed ids (`marks-01`, `marks-10-tof`, ...). A second run adds no row, and a row that breaks a CHECK fails with an error (`INSERT OR IGNORE` would drop it silently). It is not a migration, so the test database does not get these rows.
- The file holds no database id. Each W46c row finds its batch by the label (`W46c WonGi Pop Barley (house recipe)`, one batch has it) and its idea by the stage of the picked idea (one picked idea for each stage), with `INSERT ... SELECT`. If the batch is not found, the row is not added, and the count of 21 shows it.

### 2.6 Deploy order and tests

A merge to `main` deploys the Worker at once. `AGENTS.md` section 7: code that needs a new table merges only after the migration is live.

| Step | What | Test or check |
|---|---|---|
| A | Pull request 1: `migrations/0014_verdicts.sql` only. | `npm run check` (the test database applies every migration). A test inserts one row of each stage and shows that the CHECK rules and the trigger refuse a bad row. |
| B | The owner says yes. The migration runs on the live database as `docs/deploy.md` step 3 says. | Read back: `SELECT name FROM d1_migrations` shows `0014_verdicts.sql`; `SELECT COUNT(*) FROM verdicts` gives 0. |
| C | Pull request 2: the write path, the read path, the prompts and the docs. | Tests: each rule of 2.2 refuses the bad input; `taste_log` returns verdicts newest first and obeys the limit; the prompt text names only real tools. |
| D | The backfill file runs once on the live database (the owner's yes covers it). | A test seeds a batch with the W46c label and one picked idea for each stage, runs the file twice and gets 21 rows; on a database with no such batch it gets the 3 Phase 0 rows only. Live read back: 21 rows; `taste_log` shows them. |

### 2.7 What this design does not do

- No automatic canon change. `learn` reads the verdicts; a canon change still goes through `canon_update` with his quote and the gold test.
- No pattern match on his words. A rule stays taste in plain words.
- No reply to client comments, and no copy of pack comments into `verdicts` (the `comments` table does not say who wrote a comment).
- No new step for the owner. He speaks as he does today; the agent saves his words.
- No learning from client results (a separate backlog item).

## 3. The alternative that was rejected

Keep the batch notes as the store, and let `learn` read `batch_get` notes for the last batches.

Rejected, because: notes are one free-text field that each `batch_update` replaces, so one wrong call loses all earlier verdicts; a note has no stage, mark, picture or pack version, so `learn` cannot tell a pass from a fix; the read is not bounded (one `batch_get` for each batch); and the Phase 0 verdicts have no batch to hold them.

## 4. Size of the build

| Item | Value |
|---|---|
| Files | `migrations/0014_verdicts.sql`, `scripts/backfill-verdicts.sql`, `worker/batch.ts` (`batchUpdate`, `tasteLog`), `worker/mcp.ts` (`batch_update` schema, `taste_log` and `batch_update` descriptions), `worker/prompts.ts` (4 sentences), `plugin/commands/learn.md`, `docs/creative-playbook.md`, `AGENTS.md` (decision D2), `docs/marks.md` (header line), `docs/decisions.md`, `tests/batch.test.ts`, `tests/mcp.test.ts` |
| New tests | About 10 |
| Effort | M (2 pull requests and 2 live steps) |
| Cost | US$0. No new tool, no new binding, no new dependency. |
| Risk | LOW. One new table. No change to `picks`, to the paid path or to any pack. |

## 5. The decision for the owner

Result: the design is ready. Today only your draft picks are kept; your notes on finals, full passes and copy verdicts are lost after the chat ends.

- The build adds one table (`verdicts`) and saves your exact words each time you judge a draft, a final or pack copy.
- `learn` then reads them. Nothing changes in how you work.
- It needs one live D1 migration and one import of the old rows of `docs/marks.md` (21 verdicts; the 3 draft picks of W46c are in `picks` already).
- Recommendation: yes.

The owner approved the build, with the live migration and the one-time import, on 2026-11-12 (`docs/decisions.md`, row "Build the owner-verdicts design", 2026-11-12).
