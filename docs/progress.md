# Project progress and direction

This is the shared handoff for Claude Code and Devin on `a11-adgen`. It records what changed, what is still open and what to do next. The old `ai-ad-generator` is a reference only. Use the [v1 lessons](v1-lessons.md) to inform work in this repo, not as a separate workstream.

Use the [blueprint](blueprint.md) for the system design, the [decisions log](decisions.md) for owner decisions and the [backlog](backlog.md) for work that is parked or declined.

## Current state

Reviewed 19-11-2026 SGT. Merged means on `main`; it does not mean verified in production.

| Work | Status and evidence | Next action |
|---|---|---|
| Engine 3 creative overhaul | The [Fickle Feline proof run](engine-3-overhaul.md#101-result) produced usable ads but did not meet the owner's pay test. The owner approved the build and continued refinement. The [IRVINS test](creative-playbook.md#78-engine-3-drafts-start-from-the-picked-rough-owner-19-11-2026) showed that a high-quality edit of the picked rough worked better than drafts built from new layouts. That path is on `main` ([PR 116](https://github.com/han669669/a11-adgen/pull/116)), along with real food references and pack checks ([PR 117](https://github.com/han669669/a11-adgen/pull/117)). | Continue refinement against the five reference ads. Check future batches against the pay test before calling the overhaul ready. |
| Engine 3 roughs | Roughs before copy review are merged ([PR 114](https://github.com/han669669/a11-adgen/pull/114)). This handoff does not verify the live state of D1 migration `0017_roughs`. | Confirm the live migration before relying on roughs. If it is not live, get the owner's approval before applying it. |
| Engine 2 and client delivery | Engine 2 stays the default. The client pack and results path are built; the first paying client week is still pending in the [blueprint](blueprint.md#10-build-plan). | Keep the daily Engine 2 process unchanged. Verify the pack and results loop in the first approved client week. |
| Draft note limit on the board | In progress: [PR 122](https://github.com/han669669/a11-adgen/pull/122) is open. The API refuses a pick note over 600 characters with a 400 and saves nothing; before, it cut the note and returned 200. The board shows the count and blocks **Save my picks**. Checked locally (`npm run check`, a recorded Chrome run on local D1 and R2). Checked on the live site on 19-11-2026, read only: it still has the old behaviour, and no saved note is at or over 600 characters, so no real note was cut. Not verified live: the fix itself. | Owner: review and merge PR 122. The merge deploys the API part. The board part also needs the manual upload of the web app files ([deploy guide](deploy.md)). Then run the live check: a note of 601 characters must give a 400 and save nothing. |

Keep Engine 3 opt-in: start it only when the owner asks for it, as recorded in the [decisions log](decisions.md). Get the owner's approval before a paid run, a live D1 migration or a manual deploy. A merge to `main` deploys the Worker automatically; follow the [merge rule](../AGENTS.md#9-workflow) and the [deploy guide](deploy.md).

## Keep this handoff current

1. Before starting, check this page and the open PRs. If another agent owns the work, coordinate with that agent instead of opening a second PR for the same change. Work on a separate branch for each change.
2. At each milestone or handoff, update your work's row or add one, and set the review date. Record the status (planned, in progress, blocked, merged or verified live), a public evidence link and the next action. For a blocker, name what must change and who can resolve it. Fold resolved issues into the current status; use linked PRs and decisions for the history.
3. Put the update in the same PR as the change. If someone else updated this page while your PR was open, keep both updates. For routine progress without a change to ship, use the current PR or the handoff to Ava. Open a docs-only PR when a lasting change to status or direction needs to be on `main`; even a docs-only merge deploys the Worker. State what was checked and what was not verified. Use automated checks first; use manual review where needed, such as for ad quality or owner taste.
4. Send the Coordinator (Ava) what changed, what was resolved, what is blocked and what to do next. For a decision only the owner can make, include your recommendation and the exact action needed. If you cannot message Ava directly, summarise the public part in the PR and return the link in your normal handoff for relay to Ava. If there is no PR, return a short handoff through the person or session that assigned the work. Ava brings decisions to the owner in the main chat and relays answers. Continue work that does not depend on the answer.
5. Share private details only in a private handoff for Ava. Do not add credentials, private links, client data or open security findings to the repo or PRs.
