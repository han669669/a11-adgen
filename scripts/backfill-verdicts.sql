-- One-time import of the old owner marks of docs/marks.md into verdicts (docs/design/owner-verdicts.md section 2.5).
-- Run it once on the live database after migration 0014. A second run adds no row (fixed ids, ON CONFLICT(id) DO NOTHING).
-- A row that breaks a CHECK fails with an error. The file holds no database id: each W46c row finds its batch by the label
-- (only when exactly one batch has that label: else the W46c rows are not added and the read-back shows 3, not 21)
-- and its idea by the stage of the picked idea. Rows 3 to 5 (the W46c draft picks) are in picks already and are not copied.
-- Expected result: 21 rows (18 W46c rows and 3 Phase 0 rows with no batch).

INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  VALUES ('marks-01', NULL, NULL, NULL, NULL, 'final', 'fix', 'Usable', '"issues with the brand logo being not properly aligned with actual brand logo, and the actual food product looks ai slop ai food slop generated"', 'P0 WonGi Pop Barley, Hook, "Somehow the jar is empty again." (`docs/p0-wongi-final.jpg`). Lesson: 1. A painted logo is never exact: use the real logo file. 2. Painted food reads as AI: no loose painted food unless the idea needs it; match texture to the brand''s real close-up photo; add a photo finish.', '2026-11-07T00:00:01.000Z')
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  VALUES ('marks-02', NULL, NULL, NULL, NULL, 'final', 'approve', 'Usable, preferred over A', '"looks so much better and definitely usable"', 'P0 WonGi, version B (`docs/p0-wongi-final-b.jpg`; R2 `renders/18fc1e60…/1-c.jpg` was later overwritten by a trim test): no painted logo, real logo file drawn in code, real-photo kernel texture, no loose kernels. Lesson: Logo by construction and real-photo texture are the standard.', '2026-11-07T00:00:02.000Z')
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-06', b.id, i.id, NULL, NULL, 'final', 'reject', 'Not usable, fixes asked', '"the label''s correct while the inner container doesn''t align with physics ... as if the container''s shot with a real camera in one angle and the label''s shot with a real camera in another"; "the tof container''s height doesn''t match"; the food "isn''t actually appetizing"', 'W46c tof v2 (`renders/27c3688c-903b-4303-824e-dd4fa43487c7/1.jpg` is the finish-pass try; v2 shown was the blend `be676ec3-f5f7-42b7-8db9-022ecbf7efd7`). Lesson: The open neck must come from the packshot''s own camera angle and true height (§7.4 C). Food needs the real close-up''s golden colour (§7.4 0).', '2026-11-07T00:00:06.000Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'tof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-07', b.id, i.id, NULL, NULL, 'final', 'fix', 'Container right, fixes asked', '"container looks proper"; food not appetizing; "the brand logo seems a bit too high ... shifted downward a little bit to include breathing empty space"', 'W46c mof v2 (blend `863bad45-41e9-4059-8d28-bd16f2c86d20`). Lesson: Logo top 5 to 7% of the height (§7.4).', '2026-11-07T00:00:07.000Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'mof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-08', b.id, i.id, NULL, NULL, 'final', 'fix', 'Container right, fixes asked', '"container looks proper for mof and bof but ... the food critic i gave for tof ... applies here as well" (food not appetizing); "both mof and bof''s brand logo seems a bit too high up the top middle edge ... shifted downward a little bit to include breathing empty space"', 'W46c bof v2 (blend `aaebc06f-8789-49df-8c13-7add2319718e`). Lesson: Same two fixes.', '2026-11-07T00:00:08.000Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'bof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  VALUES ('marks-09', NULL, NULL, NULL, NULL, 'final', NULL, 'Corrected: not a product-truth bar', '"p0-wongi-final-b has the wrong container not real life shape problem and ai food slop Not appetizing now that i see it LOL"; "maybe ours are already good and usable, it was simply my internal bias"', 'P0 WonGi version B again (`docs/p0-wongi-final-b.jpg`). Lesson: Keep from it: the real logo drawn in code, the warm cohesive palette and soft shaped light. Do not copy its jar shape or its kernels. Product truth comes from the real packshot and close-up (§7.3, §7.4).', '2026-11-07T00:00:09.000Z')
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-10-tof', b.id, i.id, NULL, NULL, 'final', 'fix', 'Much more usable', '"yes its much more usable now"; "the backdrop doesn''t bother me looks fine, food seems slightly more Appetizing than before i like it but still many much rooms for improvements"; "the wongi logo branding needs to be big enough similar to the mof ad, as of right now its too small to me taste"', 'W46c v3 set (tof, mof, bof blends from the product lock). Lesson: Bigger logo (§7.4). Stronger food grade (§7.4 0). The bof backdrop shift was fine.', '2026-11-07T00:00:10.000Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'tof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-10-mof', b.id, i.id, NULL, NULL, 'final', 'fix', 'Much more usable', '"yes its much more usable now"; "the backdrop doesn''t bother me looks fine, food seems slightly more Appetizing than before i like it but still many much rooms for improvements"; "the wongi logo branding needs to be big enough similar to the mof ad, as of right now its too small to me taste"', 'W46c v3 set (tof, mof, bof blends from the product lock). Lesson: Bigger logo (§7.4). Stronger food grade (§7.4 0). The bof backdrop shift was fine.', '2026-11-07T00:00:10.001Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'mof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-10-bof', b.id, i.id, NULL, NULL, 'final', 'fix', 'Much more usable', '"yes its much more usable now"; "the backdrop doesn''t bother me looks fine, food seems slightly more Appetizing than before i like it but still many much rooms for improvements"; "the wongi logo branding needs to be big enough similar to the mof ad, as of right now its too small to me taste"', 'W46c v3 set (tof, mof, bof blends from the product lock). Lesson: Bigger logo (§7.4). Stronger food grade (§7.4 0). The bof backdrop shift was fine.', '2026-11-07T00:00:10.002Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'bof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-11-tof', b.id, i.id, NULL, NULL, 'final', 'reject', 'v4 food rejected, tof height still wrong', '"im hating disliking the richer caramel colour in the kernels the v3 was better in my opinion this v4 the food looks not real and fake, not ai food slop fake but simply fake looking plastic looking"; "the tof still has persistence container height problem not matching of the actual real life container"', 'W46c v4 set. Lesson: Stronger grade looks plastic: keep the v3 grade. The open jar''s neck was too narrow (measured 0.90 of the body) and its height is unverified (§7.4 C).', '2026-11-07T00:00:11.000Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'tof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-11-mof', b.id, i.id, NULL, NULL, 'final', 'reject', 'v4 food rejected, tof height still wrong', '"im hating disliking the richer caramel colour in the kernels the v3 was better in my opinion this v4 the food looks not real and fake, not ai food slop fake but simply fake looking plastic looking"; "the tof still has persistence container height problem not matching of the actual real life container"', 'W46c v4 set. Lesson: Stronger grade looks plastic: keep the v3 grade. The open jar''s neck was too narrow (measured 0.90 of the body) and its height is unverified (§7.4 C).', '2026-11-07T00:00:11.001Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'mof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-11-bof', b.id, i.id, NULL, NULL, 'final', 'reject', 'v4 food rejected, tof height still wrong', '"im hating disliking the richer caramel colour in the kernels the v3 was better in my opinion this v4 the food looks not real and fake, not ai food slop fake but simply fake looking plastic looking"; "the tof still has persistence container height problem not matching of the actual real life container"', 'W46c v4 set. Lesson: Stronger grade looks plastic: keep the v3 grade. The open jar''s neck was too narrow (measured 0.90 of the body) and its height is unverified (§7.4 C).', '2026-11-07T00:00:11.002Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'bof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-12-tof', b.id, i.id, NULL, NULL, 'final', 'fix', 'Logos right; tof jar and bof kernels not', '"yes v5''s logos are right right now. tof jar seems the same to me, the correct dimension seems to be mof''s jar"; "the food inside of bof all the food looks the same across all of the containers as if u''ve copy pasted the entire product 4 times"; "there can be no patterns Discernible decipherable from a human eye, i could see the kernels repeating between jars containers too lol, it really has to be random across all"', 'W46c v5 set. Lesson: The open jar must be as tall as the closed one (§7.4 C). Each pack in a row needs its own kernels (§7.4 D).', '2026-11-07T00:00:12.000Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'tof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-12-mof', b.id, i.id, NULL, NULL, 'final', NULL, 'Logos right; tof jar and bof kernels not', '"yes v5''s logos are right right now. tof jar seems the same to me, the correct dimension seems to be mof''s jar"; "the food inside of bof all the food looks the same across all of the containers as if u''ve copy pasted the entire product 4 times"; "there can be no patterns Discernible decipherable from a human eye, i could see the kernels repeating between jars containers too lol, it really has to be random across all"', 'W46c v5 set. Lesson: The open jar must be as tall as the closed one (§7.4 C). Each pack in a row needs its own kernels (§7.4 D).', '2026-11-07T00:00:12.001Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'mof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-12-bof', b.id, i.id, NULL, NULL, 'final', 'fix', 'Logos right; tof jar and bof kernels not', '"yes v5''s logos are right right now. tof jar seems the same to me, the correct dimension seems to be mof''s jar"; "the food inside of bof all the food looks the same across all of the containers as if u''ve copy pasted the entire product 4 times"; "there can be no patterns Discernible decipherable from a human eye, i could see the kernels repeating between jars containers too lol, it really has to be random across all"', 'W46c v5 set. Lesson: The open jar must be as tall as the closed one (§7.4 C). Each pack in a row needs its own kernels (§7.4 D).', '2026-11-07T00:00:12.002Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'bof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-13-tof', b.id, i.id, NULL, NULL, 'final', 'approve', 'tof good, mof looks pasted, bof kernels wrong', '"looks much beter bof''s four jars randomness, but u''ve introduced a new problem which is the kernel''s don''t look like the actual food product''s actual kernels"; "the tof and mof including the tof''s container jar looks much much better now and the food inside of it looks good too to me at least"; "the mof''s jar container needs more blending into the surroundings, dealing with shadows and lighting and what not ... it looks pasted in"', 'W46c v7 set. Lesson: Keep the tof and mof food and jar (the v3 grade, the open jar as tall as the closed one). Use the pack''s own kernels for variation (§7.4 D). Re-light the pasted pack (§7.4 E).', '2026-11-07T00:00:13.000Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'tof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-13-mof', b.id, i.id, NULL, NULL, 'final', 'fix', 'tof good, mof looks pasted, bof kernels wrong', '"looks much beter bof''s four jars randomness, but u''ve introduced a new problem which is the kernel''s don''t look like the actual food product''s actual kernels"; "the tof and mof including the tof''s container jar looks much much better now and the food inside of it looks good too to me at least"; "the mof''s jar container needs more blending into the surroundings, dealing with shadows and lighting and what not ... it looks pasted in"', 'W46c v7 set. Lesson: Keep the tof and mof food and jar (the v3 grade, the open jar as tall as the closed one). Use the pack''s own kernels for variation (§7.4 D). Re-light the pasted pack (§7.4 E).', '2026-11-07T00:00:13.001Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'mof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-13-bof', b.id, i.id, NULL, NULL, 'final', 'fix', 'tof good, mof looks pasted, bof kernels wrong', '"looks much beter bof''s four jars randomness, but u''ve introduced a new problem which is the kernel''s don''t look like the actual food product''s actual kernels"; "the tof and mof including the tof''s container jar looks much much better now and the food inside of it looks good too to me at least"; "the mof''s jar container needs more blending into the surroundings, dealing with shadows and lighting and what not ... it looks pasted in"', 'W46c v7 set. Lesson: Keep the tof and mof food and jar (the v3 grade, the open jar as tall as the closed one). Use the pack''s own kernels for variation (§7.4 D). Re-light the pasted pack (§7.4 E).', '2026-11-07T00:00:13.002Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'bof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-14-tof', b.id, i.id, NULL, NULL, 'final', 'reject', 'v11 worse than v10; revert', '"even worse now. the v10 looks much better to me, revert back to v10 way of doings things."', 'W46c v11 set (rejected). Lesson: v11 patched the packshot''s dark kernel gap (copied kernels over it) and added a "packed, resting under gravity" sentence to the blend prompts. The owner preferred v10 without both. Do not patch the packshot''s pile or add that sentence. The v10 recipe is the bar: v3 food grade, `vary-food` from the pack''s own photo, `relight`, the blend prompts as in §7.4.', '2026-11-07T00:00:14.000Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'tof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-14-mof', b.id, i.id, NULL, NULL, 'final', 'reject', 'v11 worse than v10; revert', '"even worse now. the v10 looks much better to me, revert back to v10 way of doings things."', 'W46c v11 set (rejected). Lesson: v11 patched the packshot''s dark kernel gap (copied kernels over it) and added a "packed, resting under gravity" sentence to the blend prompts. The owner preferred v10 without both. Do not patch the packshot''s pile or add that sentence. The v10 recipe is the bar: v3 food grade, `vary-food` from the pack''s own photo, `relight`, the blend prompts as in §7.4.', '2026-11-07T00:00:14.001Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'mof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, source_mark, owner_said, notes, created_at)
  SELECT 'marks-14-bof', b.id, i.id, NULL, NULL, 'final', 'reject', 'v11 worse than v10; revert', '"even worse now. the v10 looks much better to me, revert back to v10 way of doings things."', 'W46c v11 set (rejected). Lesson: v11 patched the packshot''s dark kernel gap (copied kernels over it) and added a "packed, resting under gravity" sentence to the blend prompts. The owner preferred v10 without both. Do not patch the packshot''s pile or add that sentence. The v10 recipe is the bar: v3 food grade, `vary-food` from the pack''s own photo, `relight`, the blend prompts as in §7.4.', '2026-11-07T00:00:14.002Z'
  FROM batches b JOIN ideas i ON i.batch_id = b.id AND i.format = 'bof' AND i.picked = 1
  WHERE b.label = 'W46c WonGi Pop Barley (house recipe)'
    AND (SELECT COUNT(*) FROM batches WHERE label = 'W46c WonGi Pop Barley (house recipe)') = 1
  ON CONFLICT(id) DO NOTHING;
