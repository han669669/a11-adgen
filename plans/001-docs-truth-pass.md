# Plan 001: The docs say what the repo does today

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before you go to the
> next step. If a "STOP condition" occurs, stop and report. Do not improvise.
> When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4062fb1..HEAD -- README.md AGENTS.md docs/ scripts/box_print.py`
> If an in-scope file changed since this plan was written, compare the
> "Current state" excerpts with the live text before you continue. A mismatch
> is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `4062fb1`, 2026-11-11

## Why this matters

Every agent reads `AGENTS.md` first, then `docs/blueprint.md`. Both hold
statements that are now wrong. One of them is dangerous: the monthly security
check says "Old test packs are revoked", but the owner said on 2026-11-09 to
keep W47 packs v1 to v4 live (v3 holds his 2 comments and 6 uploads). An agent
that follows the checklist could revoke them. The other items send a fresh
agent to tools that do not exist, to a manual deploy path that is now only the
fallback, and to a merge rule that the owner changed. This serves Goal 1: a
human-directed tool needs agents that start from true facts.

This plan changes documents only. It changes no code and no behaviour.

## Current state

The language rule for every doc in this repo: ASD-STE100 Simplified Technical
English, British spelling, short sentences. Dates are day-month-year or ISO, as
the nearby text uses. No emojis. The repo is public: never write a secret, a
hash, a private link or an open weakness in a file.

Wrong or stale statements (each was read at commit `4062fb1`):

1. `docs/security-checklist.md:71`:
   `| Sign-in | The allow-list is right. The set-up code is closed or known. Old test packs are revoked. |`
   Conflicts with `docs/backlog.md:22` ("Keep all versions live. The owner decides later, 2026-11-09").
2. `README.md:5`: `Status: planning. No code yet. Start with AGENTS.md, then docs/blueprint.md.`
   `README.md:10` lists `Workflows, Browser Rendering, Cron Triggers`; `wrangler.jsonc` binds none of them.
3. `AGENTS.md:87` (section 7, Deploy) gives the connector upload as the deploy
   path. The truth is in `docs/deploy.md:5-7`: Cloudflare Workers Builds
   deploys the Worker when a commit lands on `main`; the manual connector
   steps are the fallback. `AGENTS.md:87` also says "Phase 0: 14 KB" while
   `AGENTS.md:65` says "the bundle is about 225 KB". The measured bundle on
   2026-11-11 is 372 KiB (143 KiB gzip) from
   `npx wrangler deploy --dry-run --minify --outdir .wrangler/dry`.
4. `AGENTS.md:118` and `AGENTS.md:121` (section 9, rules 1 and 4): "Never push
   to `main` without the owner's explicit permission" and "Never merge or
   deploy to production without the owner's yes". The owner changed this on
   2026-11-09. `docs/decisions.md` (the row that starts "The `protect-main`
   ruleset does not require the cubic check") ends with: "Later the same day
   the owner also let threads merge when they are confident and cubic is green".
   The rule the owner's agents work to is: a thread may squash-merge its own
   pull request when it is confident and cubic, CI (`npm run check`) and the
   code review are clean. A merge to `main` deploys the Worker automatically.
   A live D1 migration still needs the owner's explicit yes.
5. `AGENTS.md:146`: a `BETTER_AUTH_SECRET` row. Auth is a small own
   implementation (`worker/auth.ts`); no such variable exists in
   `worker/env.ts`. `SIGNUP_CODE_SHA256` (`worker/env.ts:24`) is missing from
   the table.
6. `docs/blueprint.md`:
   - line 16 says "About 20 tools". `worker/mcp.ts` defines 46.
   - lines 86-93 (section 6 tool table) and line 146 name tools that do not
     exist: `brand_save_version`, `ideas_pick_save`, `render_drafts`,
     `render_edit`, `render_final`, `batch_status`.
   - lines 73, 77, 131, 134, 147 still say a batch has 4 finals ("4 finals",
     "all 4 ads", "Per batch of 4 finals", "12 low drafts", "One full batch of
     4"). A batch makes 3 ads since 07-11-2026 (1 top, 1 middle, 1 bottom of
     funnel; 9 drafts).
   - line 75 uses the ad name example `..._hook_c03_v1` and line 124 says "The
     Hook ad". The stages are `tof`, `mof`, `bof`.
   - lines 116-127 are headed "Hard checks in code". Only check 1 (the number
     check in `worker/pack.ts`, function `packPublish`) and checks 9 and 10
     (spend cap, owner-only paid actions) are in code. Checks 2 to 8 are not.
   - section 10 (lines 144-150): only Phase 3 has a status note.
   - line 162: "fal `edit` at high keeps the draft's layout | Not verified.
     Phase 0 tests it." Phase 0 tested it (`docs/phase0-results.md`).
   - line 65: "about 200 ads". The gold set has 264 (`docs/decisions.md`).
7. `docs/creative-playbook.md:52` and `docs/render-checklist.md:53` say
   "D1 to D8". `docs/render-checklist.md:19` added D9 (box print).
8. `scripts/box_print.py:13` (docstring) says: "Then take the result into the
   pack with PUT /admin/repair/<uuid>.jpg and final_attach". Agents have no
   admin token. The agent path is the MCP tool `upload_link` with kind
   `repair`, then the `curl -T` command it returns.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Full check | `npm run check` | exit 0 (typecheck, tests, vite build, wrangler dry run) |
| List real tool names | `grep -o 'name: "[a-z_]*"' worker/mcp.ts \| sort -u` | 46 tool names plus a few prompt-argument names |

## Scope

**In scope** (the only files you may modify):
- `README.md`
- `AGENTS.md` (sections 7, 9 and 11 only)
- `docs/blueprint.md`
- `docs/security-checklist.md` (line 71 only)
- `docs/creative-playbook.md` (the "D1 to D8" text on line 52 only)
- `docs/render-checklist.md` (the "D1 to D8" text on line 53 only)
- `docs/decisions.md` (append one row)
- `scripts/box_print.py` (the docstring sentence on line 13 only; no code)

**Out of scope** (do NOT touch):
- Any file in `worker/`, `app/`, `tests/`, `plugin/`, `migrations/`.
- `AGENTS.md` sections 1 to 6, 8, 10, 12. The site-copy sentence in section 2
  ("4 per week", "first 4 ads") is the live offer on a11studio.pro and is
  correct as written.
- `docs/deploy.md`. It is the source of truth for deploys.
- `docs/backlog.md`. The owner decides its rows.
- Do not revoke, publish or change any pack. This plan calls no MCP tool.

## Git workflow

- Branch from current `origin/main`: `docs/truth-pass`.
- One commit is enough. Message style (from `git log`):
  `docs: match deploy rules to the live ruleset; record no-stack PR rule (#55)`.
  Use: `docs: correct stale statements in AGENTS, README, blueprint and checklists`.
- Open a pull request (ready, not draft). The PR body must say which goal the
  change moves (Goal 1) and hold a "Security check" line
  (`docs/security-checklist.md` was run; docs only; no secret, hash or private
  link added).
- Do not merge unless the operator told you to.

## Steps

### Step 1: Stop the checklist from asking for a revoke

In `docs/security-checklist.md:71` change the last sentence of the cell to:
`Old test packs are revoked, except packs that docs/backlog.md keeps live (W47 v1 to v4: the owner decides).`

**Verify**: `grep -n "W47 v1 to v4" docs/security-checklist.md` → 1 match.

### Step 2: README status and stack

Replace `README.md:5` with a status line that is true: the tool is live;
Phases 0 to 2 are done; Phase 3 code is built and waits for the first paying
client; point to `docs/blueprint.md` section 10. In the Backend row, list
`Workers, D1, R2, KV (OAuth), Images` and remove
`Workflows, Browser Rendering, Cron Triggers`.

**Verify**: `grep -c "No code yet" README.md` → `0`.

### Step 3: AGENTS.md section 7 (Deploy)

Rewrite the first paragraph of section 7 (line 87) to say:
- Deploys run through Cloudflare Workers Builds: a commit on `main` builds and
  deploys the Worker `a11adgen`. See `docs/deploy.md`.
- The connector upload is the fallback only, and its steps live only in
  `docs/deploy.md` ("Manual deploy (fallback)"). Remove the step detail from
  AGENTS.md so one source remains.
- D1 migrations and the web app files in R2 `app/` are still manual
  (`docs/deploy.md`). A live D1 migration needs the owner's explicit yes.
- Bundle size: replace "Phase 0: 14 KB" with "372 KiB minified, 143 KiB gzip
  on 2026-11-11". In `AGENTS.md:65` replace "the bundle is about 225 KB" with
  the same figure.

Keep the admin token paragraph and its table unchanged.

**Verify**: `grep -c "Phase 0: 14 KB" AGENTS.md` → `0`; `grep -c "Workers Builds" AGENTS.md` → at least `2`.

### Step 4: AGENTS.md section 9 (merge rule) and a decisions row

Change rule 1 and rule 4 of section 9 to keep the default and add the
exception:

- Rule 1: "Never push to `main` directly. Work on a branch ...".
- Rule 4: "Merge only with the owner's yes, or under the standing rule of
  09-11-2026: a thread may squash-merge its own pull request when it is
  confident and cubic, CI (`npm run check`) and the code review are all clean.
  A merge to `main` deploys the Worker (section 7). A live D1 migration, a
  manual deploy and anything in section 10 still need the owner's explicit
  yes."

Append one row to the table in `docs/decisions.md` (same column layout as the
last row: date, decision, who, why), dated 2026-11-11, that records: AGENTS.md
section 9 now states the 09-11-2026 self-merge rule and its three conditions;
the docs truth pass corrected the items in this plan. Who: `agent (improve
pass); rule from han, 09-11-2026`. Why: `Goal 1: agents start from true rules.`

**Verify**: `grep -c "standing rule of 09-11-2026" AGENTS.md` → `1`; `tail -1 docs/decisions.md | grep -c 2026-11-11` → `1`.

### Step 5: AGENTS.md section 11 (secrets table)

Delete the `BETTER_AUTH_SECRET` row. Add a row:
`| SIGNUP_CODE_SHA256 | Plain var (a hash, not a secret) | Hash of the set-up code for sign-up. The owner sets it in the dashboard. Not in wrangler.jsonc. |`

**Verify**: `grep -c BETTER_AUTH AGENTS.md` → `0`; `grep -c SIGNUP_CODE_SHA256 AGENTS.md` → at least `2`.

### Step 6: blueprint.md

1. Line 16: "About 20 tools" → "46 tools (2026-11-11)".
2. Section 6 tool table (lines 86-93): replace each tool name that does not
   exist with the real one. Get the real names with the "List real tool names"
   command. Map: `render_drafts`/`render_edit`/`render_final` →
   `render_submit`, `final_render`, `food_fix`, `region_fix`, `render_status`;
   `ideas_pick_save` → `ideas_save` (field `picked`) and `ideas_update`;
   `brand_save_version` → `brand_save`; `batch_status` → `batch_get`,
   `batch_update`. Do not invent a name: every backticked snake_case tool name
   you leave in this file must be in the command output.
3. "4 finals" → "3 finals"; "all 4 ads" → "all 3 ads"; "Per batch of 4
   finals" → "Per batch of 3 finals"; "12 low drafts" → "9 low drafts"; "4 fix
   edits"/"4 high finals" → 3; "One full batch of 4" → "One full batch (3 ads
   since 07-11-2026)". Mark the cost totals "not re-measured".
4. `_hook_c03_v1` → `_b01_tof_c03_v1`; "The Hook ad" → "the top-of-funnel
   (`tof`) ad".
5. Section 8: rename the heading to "Hard checks (budget 15)" and add a status
   to each item: "built" for 1 (`pack_publish` number check), 9 and 10;
   "not built: the critic and the agent check it by reading" for 2 to 8.
6. Section 10: add a "Status (2026-11-11)" column: 0 done; 1 done; 2 done;
   3 code built, waits for the first paying client (owner's decision on hold);
   4 not started, starts only when the owner asks.
7. Line 162: status → "Verified in Phase 0 (`docs/phase0-results.md`)".
8. Line 65: "about 200 ads" → "264 ads".

**Verify**:
`for t in brand_save_version ideas_pick_save render_drafts render_edit render_final batch_status; do grep -c "$t" docs/blueprint.md; done` → six lines of `0`.
`grep -c "batch of 4" docs/blueprint.md` → `0`.

### Step 7: D9 and the box_print docstring

- `docs/creative-playbook.md:52` and `docs/render-checklist.md:53`:
  "D1 to D8" → "D1 to D9".
- `scripts/box_print.py:13`: replace "with PUT /admin/repair/<uuid>.jpg and
  final_attach" with "with the MCP tool upload_link (kind repair) and the curl
  command it returns (no admin token)". Change nothing else in the file.

**Verify**: `grep -rn "D1 to D8" docs/ | wc -l` → `0`; `python3 -c "import ast,sys; ast.parse(open('scripts/box_print.py').read())"` → exit 0; `git diff --stat -- scripts/box_print.py` → 1 line changed.

### Step 8: Full check

**Verify**: `npm run check` → exit 0.

## Test plan

No new tests. Docs only. `npm run check` must still pass (some tests read
files in `plugin/` and `worker/`; none reads the files in scope, but run it).

## Done criteria

- [ ] All "Verify" commands above give the expected result
- [ ] `npm run check` exits 0
- [ ] `git status --short` lists only files from the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

- An excerpt in "Current state" does not match the live file.
- You would need to change `docs/deploy.md`, `docs/backlog.md` or any code to
  make a statement true.
- You are not sure whether a statement is a past record (a dated row in
  `docs/decisions.md` or `docs/phase0-results.md` is history: never rewrite
  history rows) or a current rule.

## Maintenance notes

- `tests/mcp.test.ts` already fails when a prompt or a plugin agent names a
  tool that does not exist. A follow-up could add `docs/blueprint.md` to that
  scan. It is not in this plan.
- The reviewer should read the new AGENTS.md section 9 rule 4 word for word:
  it grants merge rights and so deploy rights.
