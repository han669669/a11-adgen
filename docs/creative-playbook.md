# Creative playbook

Read this file before you write ideas for a batch (`ideas_save`). It replaces the four weekly formats with three funnel stages (owner, 07-11-2026). The owner's taste notes in `docs/taste-seed.md` still apply. This file says how to use them. The owner's picture notes from v1 (writing on props, scale, props, physics, hands) are in `docs/render-checklist.md`.

Sources: the owner's "$100M Static Ad Playbook" (pasted in chat, 07-11-2026), the W46 drafts, option B (`docs/p0-wongi-final-b.jpg`), and Meta Ad Library research for Singapore (Apify runs `rIMpAosXb7tdOEvVl` and `vSy2L8RrlzMeyeT2w`, 07-11-2026).

## 1. Why W46 failed and option B worked

The 12 W46 drafts had no render defects. The jar, the label and every word were correct. The owner still found none of them usable. Option B was usable.

| | W46 drafts | Option B |
|---|---|---|
| Headline | A product fact or a logistics line ("What's in every crunch.", "Four jars. Free delivery.") | A buyer's own feeling ("Somehow the jar is empty again.") |
| Picture | Illustrates the headline with props (suitcase, chip bag, callout lines) | Is the joke: the jar is almost empty |
| Variety | 12 drafts, one look: beige wall, jar in the centre, headline on top | One calm, warm product photo |
| Pick | One idea per format, so a weak format idea beat a strong idea | It was the strongest idea. W46 left it out because another "hook" was picked. |
| Critic | Ranked craft (jar centred, label clean) | (not ranked by the critic) |

The cause was the idea and the pick, not the render. The model drew every W46 layout cleanly. Do not add render rules to fix an idea problem (`docs/v1-lessons.md` §2.2).

## 2. The bar: the option B test

Pick an idea only when the answer to all four questions is yes:

1. **One idea.** Do the picture and the headline make one point together? Cover the headline: does the picture still carry half of it?
2. **The buyer's truth.** Does a Singaporean snacker see their own behaviour or feeling in it, in words they would use? Not a product claim.
3. **Calm.** One focal product. Does every prop, line and sticker earn its place (`taste-seed.md` §1, "Hates"; `render-checklist.md` F2, F6)?
4. **Real.** Is the product the real packshot (draft from the kit's packshot reference), with the real logo drawn in code? If the ad shows food, does the food match the kit's texture photos (§6)? Food that looks painted rejects the ad.

Then apply the owner gate in `taste-seed.md` §2 (Singapore truth, no ethnicity, race or religion, logo, funnel fit), then the render defects.

## 3. Funnel stages

Three ads per batch: 1 tof, 1 mof, 1 bof (owner, 07-11-2026). The database allows at most one pick per stage, and `batch_update` requires exactly one per stage before status `board`. The owner runs batches until one ad is top tier, so judge each final as if it is the only ad the client sees.

| Stage | Job | What to lead with | Never |
|---|---|---|---|
| `tof` top of funnel (cold) | Stop a stranger who has not heard of the brand. | A human truth or a persona sorting line ("For the one who finishes the jar in one sitting"). Native looks are allowed: a meme layout, a phone-photo moment. Never a handwritten note or sticky note: painted handwriting reads as AI (`render-checklist.md` D1). | Offer stickers, prices, feature lists. |
| `mof` middle (warm) | Give a reason to switch. | Sell the switch: name what they eat now (fried chips, the office biscuit tin, the 3 pm vending machine) and the one difference that matters. Or credibility from a figure this buyer trusts (an archetype, never a real person without consent). | Callout lists of every feature. |
| `bof` bottom (ready to buy) | Give a reason to buy now. | One simple, true offer from the product facts (for example a delivery threshold, a bundle, a guarantee), with its source. Show the product clearly. | A freebie stack the brand cannot fund. A wrong price. |

## 4. What works for Singapore snack brands (research, 07-11-2026)

- The proven angle is "you cannot stop eating it". IRVINS runs "Dangerously Addictive". The Cocoa Trees runs "bold, addictive flavours that are hard to put down" in 4 versions since 08-09-2026 (the longest-running snack ad found). The Purest writes "3AM: 'Maybe just one chip' (it's never one chip)". Option B uses the same truth without the word "addictive". Find new ways into this truth. Do not copy their words.
- Most Singapore food ads are plain food photos. A clear idea stands out because the bar is low.
- Native voice gets spend: "Lowkey obsessed with this" (49 Seats), first-person stories (most long-running non-food ads in the sample).

## 5. Process for each batch

1. Research: the product page facts, buyer words (Reddit, reviews), and the Ad Library through Apify (the oldest active statics in the category; record how long each has run). Read the angle, never the look.
2. Burst: at least 8 ideas per stage before you pick. Ideas cost nothing; drafts cost money.
3. Kill: apply §2, and kill an idea that needs a `render-checklist.md` defect (D1 to D8) to work. Most ideas must die here. If fewer than the needed picks survive, write more ideas. Do not lower the bar.
4. Mix: at least 1 of the 3 picks in a native look (not the beige studio look).
5. Draft: 3 `low` drafts per picked idea, with the packshot as the reference. Write the product's real size and the `render-checklist.md` §4 lines that fit the look into every prompt (the studio style line only for a studio look). When the ad shows food, also pass the kit's texture photo and put the kit's food words in the prompt. Say in the prompt that the texture photo is a texture cue only: do not copy its amount of food or its state.
6. Pick (D2, Claude): judge each draft against §2 first, then `render-checklist.md` §1 to §3 at phone size, craft last. Pick one per idea with `picks_save`, then `final_render`.
7. Food truth (§6): `food_fix` on every final that shows food, then the food check. Repeat until the food matches. Use `region_fix` for one non-food checklist defect (`render-checklist.md` §5), poll `render_status`, and check the edit and its edges at full size. Then `compose_final` the completed key.
8. Final check: §2 and `render-checklist.md` again on the composed final. When a final fails, say which item in the report. Do not send it.

## 6. Real food (owner, 07-11-2026)

The food must look like the real product. In W46b every final showed the caramel Pop Barley as round balls with leopard spots. The real kernels are lumpy, split open, with a crackled caramel net. A one-line prompt instruction did not fix it reliably, so food has its own stage.

1. **Kit.** Each food brand's kit has texture photos (real close-ups) and `food`: the real food in words, written once from those photos. Say the shape, the surface, the colour, how the pieces sit, and what it must never look like. Save it with `brand_save`. Name the colour against its wrong neighbour ("deep amber, darker than pale tan") and the pattern's shape ("angular cracks, not round dots"), and name small true details (a split seam with a dark husk line). In W46b the general words gave pale kernels with leopard dots; these exact words gave the real colour and cracks in one round (kit v3).
2. **Drafts.** Pass the texture photo with the packshot, and put the kit's food words in the prompt.
3. **`food_fix`.** On every finished final that shows food, give boxes around all the food (also the food inside a jar). The server builds a mask. fal treats the mask as a guide only and re-renders the whole picture (in W46b the chips outside the mask became barley). So when the result arrives, the Worker pastes only the boxes onto the original final: outside the boxes the picture stays the original (re-encoded once as JPEG at quality 95). When the paste cannot run, the render fails; the raw fal image is never saved. Text, glass, reflections, labels or props inside a box can still change, so keep the boxes tight and check those parts in the food check. In `keep`, never call the surface under the food "clean" or "empty": in W46b that removed the heap. The references are the final, the texture photos and the packshot. The texture photo is a texture cue only: the amount of food and its state (heap, jar fill level, crumbs) come from the final, not from the photo.
4. **Food check.** Crop the food at full size and put it next to the texture photo. Fail it when you see repeated identical shapes, perfect spheres, a dot or spot pattern, gloss the photo does not show, the wrong colour, or a painted look. Also fail it when a text, label, glass edge or prop inside a box changed, or when food inside a box went missing or moved. On a fail, run `food_fix` again on the new key, with tighter boxes or more `keep` detail. Never pass food you did not compare.
5. **Compose.** Run `compose_final` only on the version that passed the food check.

