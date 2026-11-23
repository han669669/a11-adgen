---
title: Engine 1 (wild concepts) - Plan
type: feat
date: 2026-11-23
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Engine 1 (wild concepts) - Plan

## Goal Capsule

- **Objective:** the owner can start an "engine 1" batch from any MCP client (Claude Code or Cursor) and get 3 wild, on-brand ads for one product: each one picture, with no words and only the real kit logo, with food that looks like the real product. Engines 2 and 3 work as before.
- **Means:** a third engine value (1) on the batch, a light server path that reuses the engine 2 machinery with a few engine 1 branches (KTD1, KTD2), one house-rules section, one MCP prompt and one plugin command.
- **Authority:** the owner's first prompt of 23-11-2026 (quoted in the Product Contract) is the spec. The Haiku "mega prompt" is input only. The owner's later answers to the 22 questions in the thread win over the assumptions below.
- **Stop conditions:** stop before any live D1 migration (the owner's explicit yes is needed). Stop if migration 0018 cannot keep every row and foreign key on a copy of the schema.
- **Execution profile:** one PR on branch `claude/project-thread-nvayh4`. Merge follows AGENTS.md §9 rule 4 (Devin Review, CI, own review). The migration runs live only after the owner's yes; the code refuses engine 1 until then.

## Product Contract

### Summary

Add engine 1 beside engine 2 (funnel ideas) and engine 3 (concepts with copy). An engine 1 batch writes 6 to 10 wild concepts, a fresh critic picks 3 blind, each picked concept gets one low draft with no words and the kit logo, the owner gives a verdict on each draft, and each chosen draft gets a high final. Finals and touch-ups use the existing tools.

### Problem Frame

The owner's free-form prompt of 23-11-2026 made 3 "usable" wild ads for Cat & the Fiddle outside the batch flow: a giant slice on yellow, two slices side by side, a cat beside a slice. Engines 2 and 3 cannot make this kind of ad: both need approved words before any render (house rule CP1), and the server adds "every object keeps its real size" to every prompt. The owner wants this kind of output as a repeatable pipeline that every client runs the same way.

Owner spec (verbatim, the spec of record): "let's try out drafting 3 drafts each of different quality and concept, it has to be wild, we would still be using the same brand and cake, it could be a slice or whatever u deem good, high tasteful creatively wild concept, has to be on-brand still, very aesthetically pleasing, no realism needed as in the actual sizing fitting of the actual food, but the cake has to be appetizing still of course, and u could definitely research online on how the actual cake and in-between slices look like, go create some books that u like u find fitting of to get inspiration, no need to be focusing so much on the copywriting there no be no text at all and simply just the branding company logo u feel me? ... the food ... has to be truthful to what ill be getting if i were to buy it".

### Key Decisions

- **The new pipeline is "engine v1" (code `engine: 1`); the old tool (`han669669/ai-ad-generator`) is now "old v1".** session-settled (user-directed, owner 23-11-2026 09:48 UTC). Rejected: keep "v1" for the old tool. Governs R10.

- **No words on the picture, only the kit logo.** session-settled (user-directed). Rejected: a headline and subline as in engines 2 and 3. Governs R3, R4.
- **3 different wild concepts in each batch, same brand and product.** session-settled (user-directed). Rejected: one concept with variants. Governs R2.
- **True size is not required; the food and the product look true to the real product.** session-settled (user-directed). Rejected: model-drawn food; exact scale. Governs R5, R6.
- **Engine 1 exceptions are named in `worker/houserules.ts` by PR, with a line in `docs/decisions.md`.** session-settled (user-directed, project rule). Governs R7.
- **Server text carries the rules, not only plugin agent files.** session-settled (user-directed, project rule). Governs R8.

### Requirements

- **R1.** `batch_create` takes `engine: 1` only with `ownerStart` (the owner's exact words). The engine stays fixed. Engines 2 and 3 do not change.
- **R2.** An engine 1 batch has exactly 3 picked concepts, in any mix of funnel stages, before status `board`. Each picked concept has one finished picture (a redo is allowed) and its `finalPrompt`.
- **R3.** `render_submit` kind `draft` on an engine 1 batch needs a picked idea and no copy approval. It renders one low draft (1024x1280, low) at the draft price. `final_render` of a chosen draft renders it high (1536x1920). Both use the wild suffix with no real-size rule.
- **R4.** Engine 1 pictures carry no words. The kit logo is set in code by default: `scripts/headline.py` sets the logo alone when no headline is given, with the same breathing-space checks. The logo may be painted into the scene when that is better (owner, 23-11-2026); a painted logo is checked against the real logo (D7).
- **R5.** The server prompt suffix for an engine 1 render leaves out the real-size sentence. Every other sentence stays.
- **R6.** Food and product truth rules (FO, PR3 to PR7, LI, D1 to D11) apply to engine 1. Copy rules (CP), the copy review, the cover and point tests (CO1, CO3), the words rules of TY, the scale rules (PR1, PR2, F1), the calm rule (ST1, F6), F5 and F7 do not apply.
- **R7.** `rules_get` serves an engine 1 section that names each exception and each rule that stays; `RULES_VERSION` changes.
- **R8.** An MCP prompt `wild` and a plugin command `/a11:wild` run an engine 1 batch to the owner's verdicts. `batch_get` gives an engine 1 batch its `nextStep`.
- **R10.** New text names the pipeline "engine v1" and the old tool "old v1". The start-point docs (AGENTS.md, CLAUDE.md, docs/progress.md, the server text) use these names.
- **R9.** Until migration 0018 is live, `batch_create` with engine 1 refuses with a clear message and writes nothing.

### Acceptance Examples

- **AE1 (R1, R9).** Before 0018: `batch_create engine 1` answers "needs migration 0018". After: it saves engine 1 and the notes start with the owner's words.
- **AE2 (R2).** An engine 1 batch with 2 picks, or 3 picks with one idea without a finished picture, cannot go to status `board`. Three tof picks are allowed; a fourth pick is refused by the pick trigger.
- **AE3 (R3).** On an engine 1 batch, `render_submit` kind draft for a picked idea with no `ownerApproved` copy starts a 1024x1280 low render. For an idea that is not picked it refuses.

### Scope Boundaries

- Out of scope: `checks_save` for engine 1 (engine 1 names D items in chat, as engine 2 does); a gold score for engine 1; calibration metrics for engine 1; any web app change; Meta text (pack step only, as today).
- Out of scope: the live run of migration 0018 (the owner's yes) and the touch-up of the cat ad (separate paid work in the thread).

## Planning Contract

### Key Technical Decisions

- **KTD1. A real engine value 1, with migration 0018 that builds `batches` again.** SQLite cannot change the CHECK `engine IN (2, 3)` in place. The rebuild follows the 0004 pattern (`PRAGMA defer_foreign_keys = on`, new table, copy rows in rowid order, drop, rename, indexes, the `batches_engine_fixed` trigger). Rejected: engine 1 stored as engine 3 plus a marker in the notes. Every `engine === 3` branch (brief, concept checks, eligibility, roughs, calibration) would need a second test, and engine 1 data would count as engine 3. A rollback file builds the old CHECK again after it deletes nothing (it refuses while an engine 1 batch exists).
- **KTD2. Engine 1 reuses the engine 2 path.** Ideas use the engine 2 shape (`headline` holds the concept's short name and is never set on the picture); `ideas_pick` takes ids only; drafts, `picks_save`, `final_render`, `compose_final`, `food_fix`, `region_fix` stay the same. Engine 1 branches only in `batchCreate`, `ideasSave` (no copy warnings), `copyApprovedCheck`, the `render_submit` draft size, the board gate and `batchGet` (`nextStep`).
- **KTD3. `fal.submit` takes `wild: true`.** It changes only the suffix (no real-size sentence). Size, quality and price follow the kind: a low draft, a high final (owner, 23-11-2026: "low drafts pls, finals chosen ones will get high quality render").
- **KTD4. The migration gate reads `sqlite_master`.** Same pattern as `roughCheck`: before an engine 1 insert, check that the `batches` table SQL allows 1. No new table.
- **KTD5. One house-rules section `WI` (engine v1, wild concepts), roles all. Its rule codes are WI1 to WI10; a key `E1` would give codes such as `E11`.** It states which rules are off and which stay. No other section text changes, so engines 2 and 3 keep their rules.

### High-Level Technical Design

```
batch_create(engine 1, ownerStart) -> facts + truth photos -> research references (exa, batchId)
  -> ideas_save 6-10 concepts -> critic ideas_pick 3 (any stage)
  -> render_submit draft x3 (low, wild suffix, real brand photos as refs)
  -> headline.py logo only -> ideas_update finalPrompt -> batch_update board
  -> owner verdicts -> picks_save -> final_render / region_fix / food_fix -> compose_final
nextStepV1: concepts -> concept_pick -> pictures -> board -> owner_pick -> finals -> done
```

### Assumptions

These are the defaults sent to the owner as questions on 23-11-2026. His answers (23-11-2026 09:56 UTC) confirmed them, except where a line says "Owner changed".

- Any in-scope brand.
- 3 concepts with 1 picture each; one redo of a failed picture. Owner changed: low drafts, and a high final of each chosen draft.
- The critic picks the 3 concepts blind; the owner gives verdicts on the 3 finished ads, with no stop at the concept step.
- Owner changed: the calm rule (ST1, 5 elements or fewer, and F6) is off for engine 1. Animals are allowed and must pass the first-glance test; no human faces.
- Owner changed: the logo is set in code by default, and may be painted when that is better.
- No mood-board file: ingest reference links when they fit.
- Spend stays under the existing cap with no extra gate.

### Sequencing

U1 (migration) first, because the tests of U2 need engine 1 rows. U3 and U4 do not depend on U2.

## Implementation Units

### U1. Migration 0018: engine 1 on batches

- **Goal:** `batches.engine` takes 1, 2 or 3; every row, index, foreign key and trigger stays.
- **Requirements:** R1, R9.
- **Files:** `migrations/0018_engine_1.sql`, `migrations/rollback/0018_engine_1.down.sql`, `tests/migrations.test.ts`, `tests/helpers/d1.ts` (an optional "migrations up to" argument, for the R9 test).
- **Approach:** the 0004 pattern (KTD1). Copy the batches columns from 0002 plus `engine` from 0015. Recreate `batches_brand`, `batches_created` and `batches_engine_fixed`. If the rename fails on the triggers of `ideas` that read `batches`, drop and recreate those triggers in the same file.
- **Test scenarios:** on a database with brands, batches (engine 2 and 3), ideas, renders, picks, verdicts and records, 0018 in a transaction keeps every row; `PRAGMA foreign_key_check` is empty; engine 1 inserts; engine 4 is refused; an engine change is refused; the pick triggers still give 1 per stage for engine 2 and 3 in any mix for engine 1; a child row with a wrong batch id is refused.
- **Verification:** `npx vitest run tests/migrations.test.ts`.

### U2. Server path for engine 1

- **Goal:** an engine 1 batch runs from creation to finals through the MCP tools.
- **Requirements:** R1, R2, R3, R5, R8, R9.
- **Files:** `worker/batch.ts`, `worker/fal.ts`, `worker/mcp.ts`, `tests/engine1.test.ts`.
- **Approach:** KTD2 to KTD4. `batchCreate` accepts 1 with `ownerStart`, writes an "Engine 1 (wild) started by the owner" first notes line, and the notes update keeps that line as it does for engine 3. `nextStepV1` is a pure function beside `nextStepV3`. The board gate for engine 1 asks for exactly 3 picks, each with a finished draft, plus the existing `finalPrompt` check, with the same guarded write. Tool descriptions (`batch_create`, `ideas_save`, `render_submit`) and the server instructions name engine 1.
- **Test scenarios:** AE1, AE2, AE3; engine 1 without `ownerStart` refused; `ideas_save` on engine 1 gives no copy warnings and refuses engine 3 fields; `nextStepV1` for each state; the fal request body of an engine 1 draft has 1024x1280, low, the draft price and no real-size sentence; an engine 1 final has 1536x1920, high and the wild suffix; an engine 2 draft is unchanged.
- **Verification:** `npx vitest run tests/engine1.test.ts tests/batch.test.ts tests/fal.test.ts`.

### U3. House rules, prompt and plugin command

- **Goal:** every client gets the engine 1 rules and process from the server.
- **Requirements:** R6, R7, R8.
- **Files:** `worker/houserules.ts`, `worker/prompts.ts`, `plugin/commands/wild.md`, `plugin/.claude-plugin/plugin.json` (0.2.32), `tests/houserules.test.ts`, the test that checks plugin commands against the prompts.
- **Approach:** section `WI` (KTD5). Prompt `wild`: rules_get, brand and product, a truth sheet from the brand's real photos (sizes not needed; layers, colours and cut faces true), references from outside the category with exa and their links, 6 to 10 concepts, the critic's blind pick of 3, 3 low drafts from the real photos, logo set in code (or painted when better), show each picture beside its real photo, the owner's verdicts, then the final prompt. The `final` prompt gets one engine 1 line (logo only).
- **Test scenarios:** `rules_get` text has WI and the version changes; the `wild` prompt text names rules_get, engine 1, ownerStart and logo only; the plugin command lists the same arguments.
- **Verification:** `npx vitest run tests/houserules.test.ts` and the command test.

### U4. Logo-only mode in headline.py

- **Goal:** set the kit logo with no words, with the breathing-space checks.
- **Requirements:** R4.
- **Files:** `scripts/headline.py`, `scripts/test_scripts.py`.
- **Approach:** `--headline` becomes optional; an empty headline needs `--logo`; the text steps are skipped; the logo margin check stays.
- **Test scenarios:** logo only gives a picture that differs from the input only in the logo box; no headline and no logo is refused; a logo too near the edge is refused.
- **Verification:** `python3 -m pytest scripts/test_scripts.py -k logo_only` (or the file's runner).

### U5. Docs

- **Goal:** the handoff and the decisions log tell every agent about engine 1.
- **Files:** `docs/decisions.md`, `docs/progress.md`, `docs/creative-playbook.md` (new §7.13), `docs/deploy.md` (migration 0018 in the list), `AGENTS.md` (naming rule, R10).
- **Approach:** one decisions row with the exceptions and the dropped Haiku items; a progress row with what is and is not verified; the playbook section points to WI and the prompt.

## Verification Contract

- `npm run check` (typecheck, tests, web build, Worker dry run) passes.
- `python3 scripts/test_scripts.py` (or its pytest form) passes.
- Not verified in this PR: the live migration, a real engine 1 batch, a real fal render at high quality on engine 1.

## Definition of Done

- U1 to U5 are done and their tests pass; engines 2 and 3 tests pass unchanged.
- The PR names Goal 1 and Goal 2, has the security check line, and lists the dropped Haiku items.
- No dead code from abandoned approaches is left in the diff.
