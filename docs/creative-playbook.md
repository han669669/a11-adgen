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
4. Looks: give each of the 3 picks its own look (§7.2): a different backdrop, light and camera per stage. Do not copy option B's look onto every ad.
5. Draft: 3 `low` drafts per picked idea with the house recipe (§7.1, prompt 1). The packshot is the only reference.
6. Review (the owner picks, 07-11-2026): first rank the drafts blind with `drafts_rank` (judge each against §2, then the product shape against the packshot §7.3, then `render-checklist.md` §1 to §3 at phone size, craft last; write what you see in each reason). Read `taste_log` before you rank. Then STOP. Show the owner the drafts: one picture per idea with its 3 drafts numbered 1, 2, 3 from left to right in image order, and no rank. Name any draft that has a D item. Do not say which you prefer. The owner picks 1 per idea (or says none: then redraft that idea). Save his answer with `picks_save` and his own words. Read the result: where he chose a draft you ranked lower, find what he saw that you missed and let it steer the next batch. Then the final (§7.1, prompt 2) and, when food shows, the finish pass (§7.1, prompt 3).
7. Poll each final, finish pass and repair with `render_status`. Check the resulting key against §2 and §7.3, run the food check (§6.4) when food shows, and inspect any repair and its edges at full size. `food_fix` and `region_fix` are repair tools for a rare defect on an otherwise good final, not default steps. When a final needs more than one repair, redraft the idea with a simpler scene instead. Then `compose_final` only the verified completed key.
8. Final check: §2 and `render-checklist.md` again on the composed final. When a final fails, say which item in the report. Do not send it.

## 6. Real food (owner, 07-11-2026)

The food must look like the real product. In W46b every final showed the caramel Pop Barley as round balls with leopard spots. The real kernels are lumpy, split open, with a crackled caramel net. A one-line prompt instruction did not fix it reliably, so food has its own stage.

1. **Kit.** Each food brand's kit has texture photos (real close-ups) and `food`: the real food in words, written once from those photos. Say the shape, the surface, the colour, how the pieces sit, and what it must never look like. Save it with `brand_save`. Name the colour against its wrong neighbour ("deep amber, darker than pale tan") and the pattern's shape ("angular cracks, not round dots"), and name small true details (a split seam with a dark husk line). In W46b the general words gave pale kernels with leopard dots; these exact words gave the real colour and cracks in one round (kit v3).
2. **Drafts and finish.** Drafts get the packshot only (§7.1). The texture photo and the food words go into the finish pass (prompt 3). Show as little loose food as the idea allows: food behind the pack's own window reads as real; a heap in close-up shows every AI flaw.
3. **`food_fix` (repair only).** When the finish pass (§7.1, prompt 3) still shows food that fails the food check, give boxes around all the food (also the food inside a jar). The server builds a mask. fal treats the mask as a guide only and re-renders the whole picture (in W46b the chips outside the mask became barley). So when the result arrives, the Worker pastes only the boxes onto the original final: outside the boxes the picture stays the original (re-encoded once as JPEG at quality 95). When the paste cannot run, the render fails; the raw fal image is never saved. Text, glass, reflections, labels or props inside a box can still change, so keep the boxes tight and check those parts in the food check. In `keep`, never call the surface under the food "clean" or "empty": in W46b that removed the heap. The references are the final, the texture photos and the packshot. The texture photo is a texture cue only: the amount of food and its state (heap, jar fill level, crumbs) come from the final, not from the photo.
4. **Food check.** Crop the food at full size and put it next to the texture photo. Fail it when you see repeated identical shapes, perfect spheres, a dot or spot pattern, gloss the photo does not show, the wrong colour, or a painted look. Also fail it when a text, label, glass edge or prop inside a box changed, or when food inside a box went missing or moved. On a fail, run `food_fix` again on the new key, with tighter boxes or more `keep` detail. Never pass food you did not compare.
5. **Compose.** Run `compose_final` only on the version that passed the food check.

## 7. The house recipe (owner, 07-11-2026)

Option B was made in 3 renders plus the logo in code. W46b used more steps and busier scenes, and every extra prop, reference or stage added a new defect. On 07-11-2026 the same recipe, run again through the current tools, gave an ad almost the same as option B, with the correct label (US$0.19; `docs/decisions.md`). So this recipe is the standard. The owner: "different look for each funnel stage, no anchoring".

### 7.1 The three prompts

Fill the parts in angle brackets. Keep the rest of the words.

1. **Draft** (`render_submit` kind `draft`, 3 images, low; references: the packshot only):
   > <Look opener: "Premium studio product photograph" for a studio look, "Real phone photo, honest and unposed" for a native look> for a static social ad. Image 1 is the exact product: <product name>. Keep its label, <the label's main elements>, <the cap or closure> and <the pack material> exactly as in the photo. <The kit's shape words (kit notes), with the product's real size.>
   >
   > Scene: <one or two sentences: where the product stands (which side of the frame, not centred unless the look says so), its state that carries the idea (open, almost empty, one missing), at most one other object at its true size>. <This stage's backdrop, light and camera (§7.2)>. No other objects. No hands.
   >
   > Text, painted exactly and nothing else: leave the top band of the picture plain for a logo added later. Below it, a large headline in <the kit font>, <the kit text colour>: "<headline>" Directly under the headline, one smaller line in the same colour: "<tagline>"
   >
   > Calm and minimal, with generous clean space. <The `render-checklist.md` §4 style line for this look.> Not an illustration, no glossy AI look.

2. **Final** (kind `final`, high; references: the chosen draft only):
   > Recreate image 1 as a high-quality final ad. Keep everything in image 1 the same: composition, camera, light, the product, its label <with its distinctive details, for example "the dark brown bands at its top and bottom">, and every text exactly: <each text>. Do not add, remove or change any word. Keep the top band plain, with nothing in it.
   >
   > The story of the ad depends on this, so keep it exactly as in image 1: <the product state and every object, in words>.
   >
   > Keep the light, the shadows and the backdrop exactly as in image 1. Improve only the finish: crisp clean letter edges, real <material> reflections and the natural texture of this look (for example fine grain on a studio sweep, phone grain on a native photo). A real photograph, calm and minimal, no glossy AI look.

3. **Finish pass**, only when food shows (kind `final`, high; references: the final, then the kit's texture photo):
   > Recreate image 1 as the same high-quality ad with exactly one change. Keep everything else identical: <the same list as prompt 2>.
   >
   > The change: the <food> must look like real photographed food, exactly like image 2 (a real close-up photo of this product): <the kit's food words>. Keep the same amount in the same places.
   >
   > A real product photograph, calm and minimal.

Then `compose_final` with `brandSlug`.

### 7.2 One look per stage

Pick a different look for each of the 3 ads in a batch, and a different set from the last batch where you can. A look is a backdrop, a light and a camera. Write it in one sentence in prompt 1. Examples, not a fixed list:

| Look | Backdrop | Light | Camera |
|---|---|---|---|
| Warm studio (option B) | seamless warm cream sweep | soft window light from the left, leaf or window shadows | eye level, product a little right of centre |
| Colour block | one bold kit colour, flat | hard direct light, one crisp shadow | slightly above, product centred low |
| Real surface | a real material from the buyer's day (stone counter, wooden desk) | morning daylight | three-quarter view from above |
| Phone photo (native) | an ordinary real place | mixed indoor light, slight phone grain | handheld phone height, slightly tilted |
| Top-down | one plain surface | even soft light | straight down |

### 7.3 Product truth checks before you pick

- **Shape.** Compare each draft with the packshot: height to width, cap width and height, label position, every band and colour block on the label. The kit notes give the measured proportions (WonGi kit v4: body 2.3 times as tall as wide; cap as wide as the body and one third as tall as wide). Estimated by eye (about ±3%): without these words the option B rerun had the cap at 0.89 of the body width (real 0.97); with them, three drafts had 0.93 to 0.98. W46b drafts were not measured.
- **One object at most** next to the product, and only when the idea needs it (`render-checklist.md` F2).
- **Reference state.** A reference carries its state (Phase 0, lesson 2). Never pass a reference whose state differs from the scene, except the texture photo in prompt 3.
