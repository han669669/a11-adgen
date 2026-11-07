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
5. Draft: 3 `low` drafts per picked idea, one render each (`numImages` 1). Each draft starts from its own product-lock skeleton (§7.4): the real product at its exact proportions, placed differently per draft (position, scale, crop, light, camera), so the 3 drafts differ and the product shape is exact. When the packshot cannot show the idea's product state (an open, nearly empty jar), draft with the packshot only (§7.1, prompt 1) and build the product's state from an open source (§7.4 C) and swap it into the picked draft.
6. Review (the owner picks, 07-11-2026): read `taste_log` first. Then rank the drafts blind with `drafts_rank` (judge each against §2, then the product shape against the packshot §7.3, then `render-checklist.md` §1 to §3 at phone size, craft last; write what you see in each reason). Then STOP. Show the owner the drafts: one picture per idea with its 3 drafts numbered 1, 2, 3 from left to right in image order, and no rank. Name any draft that has a D item and tell him not to pick it. Do not say which you prefer. The owner picks 1 eligible draft per idea. If he passes on all 3 drafts of an idea, redraft that idea and add one line with his words to the batch notes (`batch_get` for the current notes, then `batch_update` with them and the new line: it replaces the whole field), because `taste_log` keeps only ideas where he picked a draft. Save his picks with `picks_save` and his own words. Read the result: where he chose a draft you ranked lower, find what he saw that you missed and let it steer the next batch. Then the final (§7.1, prompt 2) and, when food shows, the finish pass (§7.1, prompt 3).
7. Poll each final, finish pass and repair with `render_status`. Check the resulting key against §2 and §7.3, run the food check (§6.4) when food shows, and inspect any repair and its edges at full size. `food_fix` and `region_fix` are repair tools for a rare defect on an otherwise good final, not default steps. When a final needs more than one repair, redraft the idea with a simpler scene instead. Skip the finish pass when the real product pixels carry the food (§7.4): in W46c v2 the finish pass turned real kernels into glossy, round, spotted ones. Then `compose_final` only the verified completed key.
8. Final check: §2 and `render-checklist.md` again on the composed final. When a final fails, say which item in the report. Do not send it.

## 6. Real food (owner, 07-11-2026)

The food must look like the real product. In W46b every final showed the caramel Pop Barley as round balls with leopard spots. The real kernels are lumpy, split open, with a crackled caramel net. A one-line prompt instruction did not fix it reliably, so food has its own stage.

1. **Kit.** Each food brand's kit has texture photos (real close-ups) and `food`: the real food in words, written once from those photos. Say the shape, the surface, the colour, how the pieces sit, and what it must never look like. Save it with `brand_save`. Name the colour against its wrong neighbour ("deep amber, darker than pale tan") and the pattern's shape ("angular cracks, not round dots"), and name small true details (a split seam with a dark husk line). In W46b the general words gave pale kernels with leopard dots; these exact words gave the real colour and cracks in one round (kit v3).
2. **Drafts and finish.** Closed-product drafts use the product-lock skeleton as the only reference (§7.4); when the packshot cannot show the product state, draft with the packshot only (§7.1). The texture photo and the food words go into the finish pass (prompt 3), except when the real product pixels are in the picture (§7.4): then skip the finish pass. Show as little loose food as the idea allows: food behind the pack's own window reads as real; a heap in close-up shows every AI flaw.
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

- **Shape.** Compare each draft with the packshot: height to width, cap width and height, label position, every band and colour block on the label. Measure it, do not judge it by eye: read the product's box in each draft from a grid overlay and compare the height to width with the packshot's. Real WonGi jar (cap top to base): 2.65. The drafts the owner picked in W46c (07-11-2026, grid reading, about ±1%): mof 2.46 (9% too squat, cap 0.28 of the width tall against 0.40 real), bof 2.76 (4% too slim, cap 0.35). The owner saw both as wrong, and I had called them right by eye. Shape words in the prompt did not fix it. The product lock (§7.4) does. Where a draft has no lock, drop a draft that is more than 3% off.
- **One object at most** next to the product, and only when the idea needs it (`render-checklist.md` F2).
- **Reference state.** A reference carries its state (Phase 0, lesson 2). Never pass a reference whose state differs from the scene, except the texture photo in prompt 3.

### 7.4 Product lock (owner, 07-11-2026)

**Why.** A model redraws the product from a photo and drifts: in W46c the jar came out 9% too squat with a short cap, and no wording in the prompt fixed it (a two-reference prompt that asked for the packshot's proportions changed nothing). A model does keep what is already in its input image. So the real product, cut from the packshot, goes into the input at the exact proportions, and the model builds the scene around it. The label, the kernels and the shape are then real pixels. `scripts/product_lock.py` does this (Python with Pillow and numpy, run in the session).

**Packshot boxes** (read once per product from a grid overlay of the packshot; the measurements are in the kit notes or here):

| Product | Packshot | `--box` (x0,y0,x1,y1) | `--band-top` | Height ÷ width |
|---|---|---|---|---|
| WonGi Caramel Pop Barley jar | 1024 x 1024, cream backdrop | 340,70,686,986 | 286 | 2.65 |
| Same jar, cap off (open source, §7.4 C) | 1024 x 1280 padded | 340,216,686,1114 | n/a | 2.58 (derived, see C) |

**0. Food grade (food products).** The real packshot kernels are true but pale and flat, and the owner found food built from them "not appetizing" (W46c v2). Colour-grade the packshot toward the real close-up of the same food before any lock: `python3 scripts/food_grade.py --src <packshot> --ref <close-up> --ref-box <a patch of kernels> --region <food area> [--region <another>] --out <graded packshot>`. A Lab mean and spread transfer changes the kernels' colour (warm golden amber, from the real close-up), their lightness and their contrast, and clarity adds local detail back; a mask keeps the label, glass and backdrop, so the real texture and shape stay. Verify the graded result next to the close-up (§6.4) before it becomes the `--packshot`. A model repaint of the food, tried twice, gave round, glossy, spotted kernels. Use the graded file as `--packshot` below. Defaults are strength 1.0, spread x1.15, contrast x1.12 and clarity 0.7: they gave deep caramel patches and clear detail in W46c v4 (the softer v3 settings, strength 0.8 and no boost, were "slightly more appetizing" than none). Check the result next to the close-up (§6.4). Do not follow it with a model finish pass: tried again on v4 with food words that copy the close-up, the model drew round, patchy, glossy kernels (the look of `docs/p0-wongi-final-b.jpg`) and the owner had just called that look AI food.

**A. Skeleton drafts (default for a closed product).**

1. Per draft, make a skeleton: `python3 scripts/product_lock.py skeleton --packshot <file> --box <box> --size 1024,1280 --bg <the look's backdrop colour> --jar-height 0.57 --cx 0.5 --base 0.9 --out <file>`. For a row of packs add `--count 4`. Give each of the 3 drafts its own placement. Examples that worked for one idea: centred at 57% of the height, eye level, light from the left; large (74%) and right of centre with the headline on the left, camera slightly low; small (44%) at the left with a lot of empty space, camera from above, light from the right. Keep the headline's room clear in the layout.
2. Upload it: `PUT /admin/ref/<uuid>.jpg` on the Worker, with the bearer token (a new uuid per file). fal reads it at `/m/refs/<uuid>.jpg`.
3. `render_submit` kind `draft`, `numImages` 1, the skeleton as the only reference, this prompt (fill the brackets, add the variation line for that draft):
   > This image is a layout sketch: the product on the plain canvas is the real product, already placed at its true proportions. Turn the sketch into one <look opener> for a static social ad. Keep the product exactly as it is: its shape, height, width, cap, label and contents, and its size and position in the frame. Do not redraw or reshape it. Add around it: <this stage's backdrop and surface>, <light>, a crisp soft-edged shadow, a small contact shadow under the product, natural clear-plastic reflections, and clear plastic that shows the backdrop behind it (not the cream of the packshot). No other objects. No hands.
   >
   > Text, painted exactly and nothing else: leave the top band of the picture plain for a logo added later. Below it, a large headline in <the kit font>, <the kit text colour>: "<headline>" Directly under it, one smaller line in the same colour: "<tagline>"
   >
   > <Variation line: camera, light, scale, where the product stands.> <The `render-checklist.md` §4 style line.>
4. The 3 drafts now differ in layout, scale, camera and light, so the owner's pick teaches more. The skeleton fixes the shape in the model's input, not in its output: measure each draft and each final (§7.3) and drop or swap any that is more than 3% off.
5. Final (§7.1, prompt 2) from the picked draft as before, then `compose_final`. No finish pass.

**B. Swap (repair of a picked draft or final that has a wrong shape, or a product state the skeleton cannot show).**

1. Read the old product's box in the picked draft from a grid overlay: `x0,x1,top,base`.
2. `python3 scripts/product_lock.py swap --packshot <file> --box <box> --scene <draft> --old <x0,x1,top,base> --out <file>`. For an open, nearly empty jar add `--lower-only --band-top <y>`: the label and everything below it become real packshot pixels, and the open neck and rim stay from the draft. The piece brings the packshot's own bottom layer of kernels (two layers or so), so "almost empty" becomes a thin layer, not a few kernels; if the idea needs fewer, accept the thin layer or change the idea.
3. Upload it (`/admin/ref/`) and run `render_submit` kind `final`, one reference (the swapped image), this blend prompt:
   > This is an ad photograph in which the product was pasted in from a studio photo, so its edges, light and shadow do not match the scene yet. Make it one natural, real photograph. Keep exactly: <the product state and every object>; <every text>. Re-light the product to match the scene: <the scene's light>, a crisp soft-edged shadow like the one already in the scene, and a small contact shadow. The clear plastic must show <the backdrop> behind it, not cream; add natural clear-plastic reflections. Remove any cream halo or rectangle around the product. Overall look, like a premium studio photograph: one warm colour family for the whole picture (backdrop, surface, shadows and light all warm, no grey or blue cast), soft sculpted light with gentle gradients, the label paper a warm off-white with very subtle shading around the curve of the jar from the same light (not its art or words), clean soft highlights on the clear plastic. Keep the kernels exactly as pasted: you may add soft warm highlights but do not repaint, smooth, round or redraw them. Do not change the product's shape, height, width, corner radius, cap, label art or contents, or their position and size. Keep every word of the text exactly as it is. A real photograph, calm and minimal, no glossy AI look.
4. Skip the finish pass. Then `compose_final`.

**C. Open source (a product with its cap off, an open pack, a state the packshot cannot show).** A draft's open neck came from another camera angle than the real label and was too short (W46c v2 tof: the owner saw "two photos mixed"). Build the open product from the packshot itself, so every part shares its camera angle:

1. `python3 scripts/product_lock.py pad45 --packshot <file> --out <padded>` (the model edits 4:5 only; this keeps the packshot's pixels in place).
2. `render_submit` kind `final`, the padded packshot as the only reference: "Image 1 is a studio photo of <the product>. Edit only the product and keep everything else exactly as in image 1: the label and its art, the position, size and width, the camera angle and framing, the backdrop and the light. The edit: take the cap off completely and show nothing of it. Show the jar open: a clear plastic threaded neck with an open round rim, seen from exactly the same camera angle as the rest of the jar. Remove every kernel above the label. A real studio photograph." Check that the label did not move: compare it with the padded packshot (W46c: best offset 0,0 pixels, mean difference 6 of 255).
3. `python3 scripts/product_lock.py open-source --padded <padded> --edit <the model's image> --real-from <y inside the label's top band> --strip <y0,y1: threads, a whole number of thread periods> --out <open source>`. From `--real-from` down it is the real photo (label, bands and the real kernels below the label); above it is the model's open neck, with a strip of threads repeated so the neck is tall enough. The model puts the rim lower than a screw cap allows: a cap covers the whole threaded neck, so the real rim sits about 20 px (packshot scale) below the cap's top. For WonGi that is a rim at 90 in packshot pixels: add 53 px of threads (`--strip 291,343`). There is no real photo of the open jar, so this height is derived, not measured: say so to the owner.
4. Grade the kernels (0), then swap this open source into the picked draft with `swap` (`--box` from the table, `--scale` so the new jar's width equals the old jar's). A cap that stands beside the jar is the packshot's own cap, pasted at the same `--scale` (`--box 347,70,683,215`): same camera angle, true size. Blend with the prompt in B, naming the open jar, the cap and where the light falls.

**Logo room.** `compose_final` defaults (width 28%, top 3%) put the logo too close to the top edge (owner, W46c v2). Use `logoTopPct` 4 to 5 and `logoWidthPct` 24 to 26 (the owner asked for a bigger logo again after W46c v3: 17 to 22% read as too small), so the margin above the logo is at least 4% of the height. Then check the gap: the logo's bottom, as a percentage of the picture height, is `top% + width% x 0.284 x 0.8` for the WonGi logo (height ÷ width 0.284, a 4:5 picture; use the trimmed logo's own ratio for another brand). That bottom must stay at least 3% of the height above the headline's top. A headline that starts at 12% of the height leaves no room for that logo: before the blend, move the headline block down in the composite (about 30 px of 1280, on a smooth backdrop; W46c v4 mof) or leave the top 18% of the picture plain in prompt 1. With a headline at 16% or lower on the page, take width 26 and top 5.

**Result (W46c v2, from the owner's picks tof 3, mof 1, bof 3).** Jars measured by eye on a grid at the right proportions; the kernels matched the packshot's close-up (matte, netted, tan). The finish pass, tried on the same three, made the kernels glossy, rounder and spotted, so it was dropped. Cost about US$0.07 per blend.

**Limits.** The cutout is a rounded box around the measured silhouette, not a per-pixel mask: the clear plastic has no alpha in a photo, and the blend pass re-renders it. Check the corners and the glass at full size for a leftover cream halo. The skeleton needs a packshot of the whole pack on a plain backdrop. A product state the packshot cannot show (open, partly eaten, a new pack side) cannot be a skeleton: build its source (C) or draft it and swap what the packshot does show. The pasted piece brings the packshot's light into the picture, so the blend must re-light it; check the glass and the shadow at full size.

