# a11-adgen

Internal tool for a11 Studio (a11studio.pro). It makes 4:5 static Meta ads for Singapore F&B and wellness brands.

Status (2026-11-11): the tool is live. Phases 0 to 2 are done. The Phase 3 code is built and waits for the first paying client. See `docs/blueprint.md` section 10. Start with `AGENTS.md`, then `docs/blueprint.md`.

| Part | Choice |
|---|---|
| Brain | Claude Code (owner's subscription) through a custom remote MCP server |
| Backend | Cloudflare: Workers, D1, R2, KV (OAuth), Images |
| Frontend | Vite + React + TypeScript, Tailwind v4, shadcn/ui, Fluid Functionalism (`@fluid`, Radix flavour) |
| Auth | Email + password, allow-listed emails only |
| Research | Exa |
| Images | fal.ai GPT Image 2.5 Sunburst (drafts `low`, finals `high`), 4:5 |
| URL | `https://a11adgen.gamingcomputing.workers.dev` |
