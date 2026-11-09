---
description: "Run one batch (3 ads: top, middle, bottom of funnel) to the point where the owner picks drafts. Resumes a batch that has started."
argument-hint: <brand> [batchId] [productUrl] [productTitle] [label]
---
Run the a11 `batch` prompt. Its text lives on the a11 server, so this command always runs the current version.

1. Read the arguments from what the owner typed after the command: $ARGUMENTS
- brand (required): Brand slug
- batchId: Resume this batch (leave empty to start a new one)
- productUrl: A new batch: the product page URL
- productTitle: A new batch: the product's name
- label: A new batch: its label, such as W47
2. When a required argument is missing, ask the owner for it and stop.
3. Call the a11 MCP tool `prompt_get` with name `batch` and the arguments by name. Leave out an argument that is not given.
4. Follow the text it returns as the owner's instruction. If it returns an error, tell the owner in one line and stop.
