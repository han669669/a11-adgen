# Owner marks

One row per ad the owner marked. Newest last. These feed the taste canon (`docs/blueprint.md` §4).

| Date | Ad | Mark | Owner's words | Lesson |
|---|---|---|---|---|
| 2026-11-07 | P0 WonGi Pop Barley, Hook, "Somehow the jar is empty again." (`docs/p0-wongi-final.jpg`) | Usable | "issues with the brand logo being not properly aligned with actual brand logo, and the actual food product looks ai slop ai food slop generated" | 1. A painted logo is never exact: use the real logo file. 2. Painted food reads as AI: no loose painted food unless the idea needs it; match texture to the brand's real close-up photo; add a photo finish. |
| 2026-11-07 | P0 WonGi, version B (`docs/p0-wongi-final-b.jpg`; R2 `renders/18fc1e60…/1-c.jpg` was later overwritten by a trim test): no painted logo, real logo file drawn in code, real-photo kernel texture, no loose kernels | Usable, preferred over A | "looks so much better and definitely usable" | Logo by construction and real-photo texture are the standard. |
| 2026-11-07 | W46c tof, "10 minutes later, poof." (draft 3 of 3; `renders/14eca12b-fcf9-4505-8606-86eab2ef5e78/3.jpg`) | Picked, fixes asked | "food seems ai slop not true to actual real life product and the product's container doesn't match real life too, the dimensions height and width" | Measured: the draft's jar was close, its label squat. Real product pixels beat painted food (§7.4). The 3 drafts per idea were too alike to teach taste: vary layout, scale, camera and light (§7.4). |
| 2026-11-07 | W46c mof, "All the crunch. None of the frying." (draft 1 of 3; `renders/67869b17-3c10-4142-916b-3eb481c83f63/1.jpg`) | Picked, fixes asked | the same words as the tof row | Measured: height ÷ width 2.46 against the real 2.65, cap 0.28 of the width tall against 0.40. Judge shape by measuring, not by eye (§7.3). |
| 2026-11-07 | W46c bof, "One shot buy four." (draft 3 of 3; `renders/665e6c48-8318-4496-9cca-91f4ce959924/3.jpg`) | Picked, fixes asked | the same words; "the product's container for this matches real life slightly better" | Measured: 2.76 (4% too slim), cap 0.35. Matches the owner's "slightly better". |

The W46c picks were made in chat after the finals existed, so `picks_save` could not store them. They were backfilled into the database as owner picks (`by_owner` 1), so `taste_log` holds them: the owner chose the critic's rank 3, 2 and 3, never rank 1.
