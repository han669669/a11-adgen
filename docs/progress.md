# Project progress and direction

This is the shared handoff for `a11-adgen`. It records what changed, what is still open and what to do next. Use the [blueprint](blueprint.md) for the system design, the [decisions log](decisions.md) for owner decisions and the [backlog](backlog.md) for work that is parked or declined.

## Current state

Reviewed 19-11-2026 SGT. Merged means on `main`; it does not mean verified in production.

| Work | Status and evidence | Next action |
|---|---|---|
| Engine 3 creative overhaul | The [Fickle Feline proof run](engine-3-overhaul.md#101-result) produced usable ads but did not meet the owner's pay test. The owner approved the build and continued refinement. The [IRVINS test](creative-playbook.md#78-engine-3-drafts-start-from-the-picked-rough-owner-19-11-2026) showed that a high-quality edit of the picked rough worked better than drafts built from new layouts. That path is on `main` ([PR 116](https://github.com/han669669/a11-adgen/pull/116)), along with real food references and pack checks ([PR 117](https://github.com/han669669/a11-adgen/pull/117)). | Continue refinement against the five reference ads. Check future batches against the pay test before calling the overhaul ready. |
| Engine 3 roughs | Roughs before copy review are merged ([PR 114](https://github.com/han669669/a11-adgen/pull/114)). This handoff does not verify the live state of D1 migration `0017_roughs`. | Confirm the live migration before relying on roughs. If it is not live, get the owner's approval before applying it. |
| Engine 2 and client delivery | Engine 2 stays the default. The client pack and results path are built; the first paying client week is still pending in the [blueprint](blueprint.md#10-build-plan). | Keep the daily Engine 2 process unchanged. Verify the pack and results loop in the first approved client week. |

Keep Engine 3 opt-in: start it only when the owner asks for it, as recorded in the [decisions log](decisions.md). A paid run, a live D1 migration and a production deploy keep their existing approval gates. A merge to `main` deploys the Worker; follow the [deploy guide](deploy.md).

## Keep this handoff current

1. At each milestone or handoff, update the relevant row or add one for new work, and set the review date. Record the status (planned, in progress, blocked, merged or verified live), a public evidence link and the next action. For a blocker, name what must change and who can resolve it. Fold resolved issues into the current status; use linked PRs and decisions for the history.
2. Put the update in the same PR as the change. For a milestone without a code change, use a docs-only PR. State what was checked and what was not verified. Use automated checks first; use manual review where needed, such as for ad quality or owner taste.
3. Send each milestone, resolved issue, blocker and next action to the Coordinator (Ava). For each decision only the owner can make, give the Coordinator the recommendation and the exact action needed. Continue work that does not depend on the answer. The Coordinator keeps the threads aligned and brings decisions to the owner in the main chat, then relays the answers.
4. Keep private details in the Coordinator chat, not in this public repo. Do not add credentials, private links, client data or open security findings.
