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
| [001](001-docs-truth-pass.md) | The docs say what the repo does today | 1 | P1 | S | LOW | none | DONE (2026-11-11) |
| [002](002-one-batch-flow-text.md) | One batch flow in every text; drafts shown in a blind order | 1 | P1 | M | LOW | none | DONE (2026-11-12) |
| [003](003-harden-paid-render-path.md) | A paid render is never lost, charged twice or given the wrong logo | 2 | P1 | M | MED | none | DONE (2026-11-12) |
| 004 | Security hardening (2 small changes). The plan file is not in this public repo (`AGENTS.md` section 9 rule 6); the owner and the coordinator hold it in the private project files | 2 | P2 | S | LOW | none | DONE (2026-11-12) |
| [005](005-pack-copy-from-version.md) | `pack_publish` copies approved copy by itself | 1, 2 | P2 | M | LOW | none | DONE (2026-11-12) |
| [006](006-save-owner-verdicts-design.md) | Design: every owner verdict saved as data that `learn` reads | 1 | P2 | S | LOW | none (the build after it needs the owner's yes) | DONE (2026-11-12): `docs/design/owner-verdicts.md`. The owner approved the build on 2026-11-12. |

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
Findings about security, abuse limits and spend limits are not listed in this
public file (`AGENTS.md` section 9 rule 6). The owner has them in chat and in
the private project files. The numbers F4, F7, F8, F11, F16 and F17 are theirs.

| # | Finding | Evidence | Effort | Note |
|---|---------|----------|--------|------|
| F2 | The art-director subagent is named by no prompt, and lacks the tools for its own checks | `plugin/agents/art-director.md:3-4`, `worker/prompts.ts` | S | Wire it in or delete it: the owner's call. |
| F3 | Gates that are prose only: the 0.04 gold floor (`gold_score` compares with the last run, not with the "before" run), a rank for every draft before status `board`, the 3% product shape rule | `worker/canon.ts:271`, `worker/batch.ts:82-98`, `docs/creative-playbook.md:117` | M | Each is a true/false fact, so it fits the 15-check budget. Needs a decision row per check. |
| F5 | `results_save` runs one text search over all the brand's packs for each row (up to 60) | `worker/results.ts:41-52` | S | Matters only when real results exist. |
| F6 | Two queries of `taste_log` and `picks_save` have no index (`draft_ranks.idea_id`, `picks(by_owner, created_at)`) | `worker/batch.ts:233-252`, `migrations/` | S | Needs a migration, so the owner's yes. Cheap at today's size. |
| F9 | `scripts/box_print.py` (ships pixels to the client) has no test, and the Python scripts have no pinned versions | `scripts/box_print.py:197-243` | S | One stdlib `unittest` file on synthetic input; a 3-line `scripts/requirements.txt`. |
| F10 | The tool-coverage gate passes on a quoted name: `render_submit` (draft path, 150-render limit, release on refusal) and `spend_get` have no behaviour test | `tests/tools.test.ts:104-115`, `tests/mcp.test.ts:34-42,183-190` | S | |
| F12 | Merge deploys new code before a manual D1 migration; nothing enforces "migration first" | `docs/deploy.md:14-22,37` | S | A rule in `AGENTS.md`: the migration PR merges and is applied before the PR that uses it. |
| F13 | No `engines` field or `.nvmrc`, but tests need Node 22 (`node:sqlite`); Node 22 support ends in April 2027 | `package.json`, `.github/workflows/check.yml:24` | S | |
| F14 | Workers Builds runs `typecheck` and `test` only, CI runs the full `npm run check`, and the ruleset requires neither | `docs/deploy.md:14,21` | S | Setting change in Cloudflare or GitHub: the owner's account. |
| F15 | Batch labels W46, W46b, W46c and W47 were typed for batches that ran in ISO week 45; their ad names say W45 and W46 | `docs/marks.md:9-20`, `docs/decisions.md` | S | Labels are free text. `batch_create` could suggest the Singapore ISO week. |

Done since the audit: F1 (2026-11-12). The critic picks the ideas, ranks the drafts and runs the gold test in a fresh context (`docs/decisions.md`).

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
3. **An independent critic** (F1 and F2). Save all ideas first, let the critic
   subagent read them with `batch_get` and set the picks, route the draft rank
   and the gold test through it, and keep `taste-seed.md` out of a gold run.
   The critic keeps `canon_get` and `taste_log`: they are its taste context.
   Only its draft rank stays hidden from the owner until he picks.
   Trade-off: more subagent runs per batch (more plan usage) for a rank and a
   gate that can be trusted.
4. **Build hard checks 6 and 7** (headline of 7 words or fewer; no price on
   the top-of-funnel ad) in `ideas_save`. `docs/blueprint.md` section 8 lists
   them as code checks, but they are prose today. Trade-off: two of the 15
   budgeted checks; each needs a real failure as its fixture.

## Findings considered and rejected

Three more rejected items concern security and are in the private project
files with their reasons.

- **Split `worker/mcp.ts` into files per domain**: not worth it. 37 of 47
  handlers are one-line calls; the tests rely on one `TOOLS` array.
- **Add a linter or formatter**: not worth it under the "minimum tooling"
  rule. Strict TypeScript and the tests cover it.
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
