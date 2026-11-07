-- Phase 3b: the results ledger and the client's baseline CTR (docs/blueprint.md sections 4 and 5).
-- A baseline is the client's usual click-through rate, read from one Ads Manager screenshot at onboarding (decision D3).
-- A result is one ad's numbers in one report. The ad name is the one in the pack, so a result maps back to its ad.
CREATE TABLE baselines (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  ctr REAL NOT NULL,              -- a fraction: 0.012 is 1.2 percent
  source TEXT NOT NULL,           -- where the number came from, in plain words
  created_at TEXT NOT NULL
);
CREATE INDEX baselines_brand ON baselines (brand_id, created_at);

CREATE TABLE results (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  ad_name TEXT NOT NULL,          -- a11_W47_catfiddle_b01_tof_c03_v1
  report_date TEXT NOT NULL,      -- YYYY-MM-DD, the day the report was taken
  impressions INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  spend_sgd REAL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (ad_name, report_date)
);
CREATE INDEX results_brand ON results (brand_id, report_date);
