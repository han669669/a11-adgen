-- Gold runs also keep how many "use" marks the judge got right and how many "use" marks there were,
-- so a run can show balanced accuracy and the "answer pass to everything" baseline. Runs saved before this file have NULL here.
ALTER TABLE gold_runs ADD COLUMN use_agreed INTEGER;
ALTER TABLE gold_runs ADD COLUMN use_truth INTEGER;
