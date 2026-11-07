# v1 lessons

v1 is `han669669/ai-ad-generator` (Convex, TheGrid, Replicate, 9:16). It ran from 2026-10-12 to 2026-10-31. Facts below come from its docs (`docs/agent-handoff/01`, `02`, `04`, `06`, read 2026-11-06). Use them to avoid the same mistakes.

## 1. Facts

| Fact | Source |
|---|---|
| Owner Use rate: 54% in the first TheGrid era (45 of 84 ads, to 2026-10-19). 14% after 2026-10-22 (9 of 64 ads). | `04-evaluation-and-grading.md` §5 census |
| By funnel slot (TheGrid era): ToF 57%, MoF mechanism 71%, MoF proof 52%, BoF offer 33%. | same |
| The grader's score predicted the owner's Use badly (AUC 0.657). Clean renders with dull ideas scored 7 to 8; the owner rejected them. | `04` §6 |
| `AGENTS.md` grew to about 575 lines of code rules (price regexes, offer conditions, prop bans, logo heuristics). 155 test files, about 2,046 tests. | v1 `AGENTS.md`, `02-architecture.md` |
| 9 LLM setups were tested on one product in 2 days. Best: TheGrid, 1 of 4 Used. Hugging Face setups: mostly 0 of 4. | `04` §5.1 |
| The taste ranker changed 0 picks in batches B43 to B47. Exemplars (off) showed no gain. | `02` §7 |
| Most image code was for 9:16 placement: band render, trim cost, edge fill, safe fit, sticker lift. | `02` §2, §8 |
| A painted logo pasted over by code looked worse; the painted logo stayed. Code-set type lost blind tests to painted type. | `06` §2, §1 |
| Hands only when the concept needs one: hand scenes Used 7 of 31 vs 51 of 85 without. | `06` §2 |
| Typical batch spend: US$0.75 to 1.08 for 4 ads on TheGrid. | `02` §6 |

## 2. Lessons

1. **The idea is the bottleneck.** The owner's notes name the concept and the headline far more often than render defects. Spend the strongest model and the most variety on ideas.
2. **Code rules make ads safe and dull.** Each rule fixed one batch and narrowed every later batch. Keep a small budget of true/false checks. Put taste in words that a strong model reads.
3. **Grade the owner's gate first.** Idea, Singapore truth, cultural risk, "does every element earn its place", logo right. Defects second.
4. **Do not hop models.** Pick the strongest writer and keep it. Measure with the gold set, not with one batch.
5. **Variety needs cheap drafts.** v1 refused "make 6, show 4" to save money. fal `low` drafts are cheap enough to make 3 per idea.
6. **Learn in words and examples.** Number-feature learners had too little data to change picks.
7. **4:5 removes most placement code.** Do not rebuild the 9:16 machinery.

## 3. Keep from v1

- Versioned brand kits; never delete a kit or a logo file.
- The real packshot and logo as image references; the model paints the whole ad, logo included.
- Facts only from the product page; a false price is a false claim.
- Singapore default (S$, Singapore English, local moments).
- Hard no on race, ethnicity and religion in copy.
- Owner-only paid actions; per-batch and monthly caps.

## 4. Data to port (owner approved, D5)

| Data | v1 table | Use in v2 |
|---|---|---|
| Use / Pass marks, tags, notes | `tasteEvents` | Seed the taste canon; gold test set |
| Used ads (final images) | `batchAds.usedDraftId` → `adDrafts` → storage | Swipe file |
| Headlines the owner wrote or edited | `tasteEvents` edits | Canon examples |

How: the owner (or an agent with his Convex deploy key) runs `npx convex export --path v1-export.zip` with `CONVEX_DEPLOY_KEY` set (run it from a scratch folder with `convex` installed; the old repo has no `node_modules`). Ask him first. Do not commit the export to the repo.

Done 07-11-2026 (the owner gave the key in chat): the export (3.4 MB, 43 tables, no file storage, so no images) was read in a scratch folder. It also holds the v1 auth tables (accounts, sessions), so the zip is **not** stored in R2 and is not kept: only the derived marks were imported. `tasteEvents` (1,073 events) gave one gold item per ad with a final mark: 264 items, 77 use and 187 pass, each with the headline, the picture idea, the stage, and the owner's note and tags when he wrote them (`gold_import`, source `v1`). Items have no images. Rotate the Convex deploy key after an export.
