# Implementation plans

This document uses ASD-STE100 Simplified Technical English with British spelling.

Made by the `improve` skill on 2026-11-11, at commit `4062fb1`, at the owner's
request ("run /improve on this entire everything"). The skill audits and
writes plans. It changes no source code. Each plan is self-contained: an
agent with no other context can execute it.

Baseline on 2026-11-11: `npm run check` passes on `main`; `npm audit` finds
0 vulnerabilities; no secret is in the tree or in the git history.

The owner was not available to choose, so plans were written for the findings
with the most leverage. Phase 3 and Phase 4 work is not planned here: the
owner has that decision on hold.

Each executor: read the plan fully before you start, obey its STOP conditions,
follow `AGENTS.md`, and update your row when done.

## Execution order and status

| Plan | Title | Goal | Priority | Effort | Risk | Depends on | Status |
|------|-------|------|----------|--------|------|------------|--------|
| [001](001-docs-truth-pass.md) | The docs say what the repo does today | 1 | P1 | S | LOW | none | TODO |
| [002](002-one-batch-flow-text.md) | One batch flow in every text; drafts shown in a blind order | 1 | P1 | M | LOW | none | TODO |
| [003](003-harden-paid-render-path.md) | A paid render is never lost, charged twice or given the wrong logo | 2 | P1 | M | MED | none | TODO |
| 004 | Security hardening (2 small changes). The plan file is not in this public repo (`AGENTS.md` section 9 rule 6); the owner and the coordinator hold it in the private project files | 2 | P2 | S | LOW | none | TODO |
| [005](005-pack-copy-from-version.md) | `pack_publish` copies approved copy by itself | 1, 2 | P2 | M | LOW | none | TODO |
| [006](006-save-owner-verdicts-design.md) | Design: every owner verdict saved as data that `learn` reads | 1 | P2 | S | LOW | none (the build after it needs the owner's yes) | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (one-line reason) | REJECTED (one-line reason)

## Dependency notes

- No plan depends on another. 002, 003, 004 and 005 all edit `worker/mcp.ts`
  in different places: run them one after another, each from current
  `origin/main` (repo rule: no stacked pull requests, one writer per branch).
- 001 and 002 both edit `docs/creative-playbook.md` (different lines) and
  `docs/decisions.md` (append a row). Run 001 first.
- None of the six plans needs a D1 migration. A merge to `main` deploys the
  Worker automatically.

## Findings (vetted) that have no plan yet

Each was confirmed in the code at `4062fb1`. They are ordered by leverage.
Security findings are not listed in this public file (`AGENTS.md` section 9
rule 6). The owner has them in chat and in the private project files.

| # | Finding | Evidence | Effort | Note |
|---|---------|----------|--------|------|
| F1 | The critic subagent is not blind and not independent as its file claims: it may read `taste_log` and `docs/taste-seed.md` (which quotes gold-set ads with their marks), the draft rank runs in the main session, and the gold test for a canon change is run by the session that wants the change | `plugin/agents/critic.md:3-13`, `worker/prompts.ts:28,57,97` | M | Changes how the taste loop works: the owner should choose. See "Direction". |
| F2 | The art-director subagent is named by no prompt, and lacks the tools for its own checks | `plugin/agents/art-director.md:3-4`, `worker/prompts.ts` | S | Wire it in or delete it: the owner's call. |
| F3 | Gates that are prose only: the 0.04 gold floor (`gold_score` compares with the last run, not with the "before" run), a rank for every draft before status `board`, the 3% product shape rule | `worker/canon.ts:271`, `worker/batch.ts:82-98`, `docs/creative-playbook.md:117` | M | Each is a true/false fact, so it fits the 15-check budget. Needs a decision row per check. |
| F4 | Spend reservations are released on a timeout or a JSON error, although fal or Exa may still bill the call; the monthly cap can then be passed by those calls | `worker/fal.ts:74-91`, `worker/exa.ts:38-64`, `worker/spend.ts:23-28` | M | Makes the cap stricter. The owner should choose. |
| F5 | `results_save` runs one text search over all the brand's packs for each row (up to 60) | `worker/results.ts:41-52` | S | Matters only when real results exist. |
| F6 | Two queries of `taste_log` and `picks_save` have no index (`draft_ranks.idea_id`, `picks(by_owner, created_at)`) | `worker/batch.ts:233-252`, `migrations/` | S | Needs a migration, so the owner's yes. Cheap at today's size. |
| F7 | `brand_extract` can pass 50 subrequests in the worst case and does not cancel redirect bodies | `worker/brandextract.ts:14-27,183-201` | S | Rare: needs long redirect chains. |
| F9 | `scripts/box_print.py` (ships pixels to the client) has no test, and the Python scripts have no pinned versions | `scripts/box_print.py:197-243` | S | One stdlib `unittest` file on synthetic input; a 3-line `scripts/requirements.txt`. |
| F10 | The tool-coverage gate passes on a quoted name: `render_submit` (draft path, 150-render limit, release on refusal) and `spend_get` have no behaviour test | `tests/tools.test.ts:104-115`, `tests/mcp.test.ts:34-42,183-190` | S | |
| F11 | Large client files (xlsx up to 20 MB of XML, CSV up to 20 MB) and heavy home pages are parsed in the Worker; the 10 ms CPU limit is not measured for them | `worker/xlsx.ts:8-17`, `worker/uploads.ts:44-49`, `worker/brandextract.ts` | S to measure | Investigate first: time the parsers on the largest fixtures. |
| F12 | Merge deploys new code before a manual D1 migration; nothing enforces "migration first" | `docs/deploy.md:14-22,37` | S | A rule in `AGENTS.md`: the migration PR merges and is applied before the PR that uses it. |
| F13 | No `engines` field or `.nvmrc`, but tests need Node 22 (`node:sqlite`); Node 22 support ends in April 2027 | `package.json`, `.github/workflows/check.yml:24` | S | |
| F14 | Workers Builds runs `typecheck` and `test` only, CI runs the full `npm run check`, and the ruleset requires neither | `docs/deploy.md:14,21` | S | Setting change in Cloudflare or GitHub: the owner's account. |
| F15 | Batch labels W46, W46b, W46c and W47 were typed for batches that ran in ISO week 45; their ad names say W45 and W46 | `docs/marks.md:9-20`, `docs/decisions.md` | S | Labels are free text. `batch_create` could suggest the Singapore ISO week. |
| F16 | Concurrent canon evidence updates can drop one evidence entry (counters stay right) | `worker/canon.ts:93-112` | S | Unlikely with one owner. |

## Direction (options for the owner; not ranked against the bugs)

These raise ad quality or learning without a real client. None is Phase 3 or
Phase 4 work. None is on the declined list.

1. **Save every owner verdict as data** (plan 006 is its design). Today only
   draft picks are kept. Notes on finals, full passes and copy verdicts are
   lost unless a person writes them into `docs/marks.md`. Trade-off: one new
   table and a live migration (the owner's yes).
2. **A gold test from the owner's own draft picks.** The gold set is 264
   text-only v1 items; runs of one canon differ by up to 0.12, and the critic
   matched the owner's draft pick in 0 of 4 (`docs/decisions.md`,
   2026-11-08). The pipeline now depends on "which of 3 drafts does he pick".
   The `picks` and `draft_ranks` tables already hold that data. Trade-off: the
   set is small for now (about 9 picked ideas), so the score has a wide error
   band; start with a design.
3. **A truly blind critic** (F1 and F2). Save all ideas first, let the critic
   subagent read them with `batch_get` and set the picks, route the draft rank
   and the gold test through it, and keep `taste-seed.md` out of a gold run.
   Trade-off: more subagent runs per batch (more plan usage) for a rank and a
   gate that can be trusted.
4. **Build hard checks 6 and 7** (headline of 7 words or fewer; no price on
   the top-of-funnel ad) in `ideas_save`. `docs/blueprint.md` section 8 lists
   them as code checks, but they are prose today. Trade-off: two of the 15
   budgeted checks; each needs a real failure as its fixture.

## Findings considered and rejected

- **A failed PUT burns a one-time upload link**: by design. The link is
  claimed before the body is read so that it can never be used twice
  (`worker/uploadlink.ts:80`). A new link costs one free tool call.
- **`render_submit` accepts a `batch` or `idea` that is not in the
  database**: by design (`worker/batch.ts:164`: "render_submit takes
  free-form ids"); such renders do not reach the board, and the monthly cap
  still holds.
- **Split `worker/mcp.ts` into files per domain**: not worth it. 37 of 47
  handlers are one-line calls; the tests rely on one `TOOLS` array.
- **Add a linter or formatter**: not worth it under the "minimum tooling"
  rule. Strict TypeScript and the tests cover it.
- **CSV formula text in stored client uploads**: only the agent reads these
  files, as text. Revisit if a person ever opens one in a spreadsheet.
- **Batch status can move backward**: no failure seen; a resumed batch may
  need it.
- **Shared helper for SHA-256 and `now()`**: do it when that code is next
  touched; not worth its own pull request.
- **Pin GitHub Actions to commit SHAs; generate `Env` types with
  `wrangler types`**: small gain; not now.
- **Custom domain, connector icon, authentication hardening, alerts and
  reminders**: already in `docs/backlog.md` with the owner's decision.

## What was not audited

`worker/png.ts`, `worker/logohtml.ts`, `worker/icon.ts` and `worker/font.ts`
(skimmed only); the logic of `scripts/product_lock.py` and
`scripts/food_grade.py`; `app/src/views/Batches.tsx` and `SignIn.tsx`; the
vendored UI code in `app/src/components`, `hooks` and `lib`; the OAuth
library's own code; the live Worker, the live D1 data and the Cloudflare
settings (nothing live was called or changed); `han669669/ai-ad-generator`
(v1, reference only). No parser was timed against the CPU limit.
