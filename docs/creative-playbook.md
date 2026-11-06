# Creative playbook

Read this file before you write ideas for a batch (`ideas_save`). It replaces the four weekly formats with three funnel stages (owner, 07-11-2026). The owner's taste notes in `docs/taste-seed.md` still apply. This file says how to use them.

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
3. **Calm.** One focal product. Does every prop, line and sticker earn its place (`taste-seed.md` §1, "Hates")?
4. **Real.** Is the product the real packshot (draft from the kit's packshot reference), with the real logo drawn in code?

Then apply the owner gate in `taste-seed.md` §2 (Singapore truth, no ethnicity, race or religion, logo, funnel fit), then the render defects.

## 3. Funnel stages

Three ads per batch: 1 tof, 1 mof, 1 bof (owner, 07-11-2026). The database enforces it. The owner runs batches until one ad is top tier, so judge each final as if it is the only ad the client sees.

| Stage | Job | What to lead with | Never |
|---|---|---|---|
| `tof` top of funnel (cold) | Stop a stranger who has not heard of the brand. | A human truth or a persona sorting line ("For the one who finishes the jar in one sitting"). Native looks are allowed: a phone notes screen, a handwritten note, a meme layout, a phone-photo moment. | Offer stickers, prices, feature lists. |
| `mof` middle (warm) | Give a reason to switch. | Sell the switch: name what they eat now (fried chips, the office biscuit tin, the 3 pm vending machine) and the one difference that matters. Or credibility from a figure this buyer trusts (an archetype, never a real person without consent). | Callout lists of every feature. |
| `bof` bottom (ready to buy) | Give a reason to buy now. | One simple, true offer from the product facts (for example a delivery threshold, a bundle, a guarantee), with its source. Show the product clearly. | A freebie stack the brand cannot fund. A wrong price. |

## 4. What works for Singapore snack brands (research, 07-11-2026)

- The proven angle is "you cannot stop eating it". IRVINS runs "Dangerously Addictive". The Cocoa Trees runs "bold, addictive flavours that are hard to put down" in 4 versions since 08-09-2026 (the longest-running snack ad found). The Purest writes "3AM: 'Maybe just one chip' (it's never one chip)". Option B uses the same truth without the word "addictive". Find new ways into this truth. Do not copy their words.
- Most Singapore food ads are plain food photos. A clear idea stands out because the bar is low.
- Native voice gets spend: "Lowkey obsessed with this" (49 Seats), first-person stories (most long-running non-food ads in the sample).

## 5. Process for each batch

1. Research: the product page facts, buyer words (Reddit, reviews), and the Ad Library through Apify (the oldest active statics in the category; record how long each has run). Read the angle, never the look.
2. Burst: at least 8 ideas per stage before you pick. Ideas cost nothing; drafts cost money.
3. Kill: apply §2. Most ideas must die here. If fewer than the needed picks survive, write more ideas. Do not lower the bar.
4. Mix: at least 1 of the 3 picks in a native look (not the beige studio look).
5. Draft: 3 `low` drafts per picked idea, with the packshot as the reference.
6. Pick (D2, Claude): judge each draft against §2 first, craft second. Pick one per idea with `picks_save`, then `final_render`, then `compose_final`.
7. When a final fails §2, say so in the report. Do not send it.
