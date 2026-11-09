---
description: "Run one batch (3 ads: top, middle, bottom of funnel) to the point where the owner picks drafts. Resumes a batch that has started."
argument-hint: <brand> [batchId] [productUrl] [productTitle] [label]
---
Run the a11 `batch` prompt. Its text lives on the a11 server, so this command always runs the current version.

1. Read the arguments from what the owner typed after the command: $ARGUMENTS
- brand (required): Brand slug (at most 40 characters)
- batchId: Resume this batch (leave empty to start a new one) (at most 36 characters)
- productUrl: A new batch: the product page URL (at most 500 characters)
- productTitle: A new batch: the product's name (at most 160 characters)
- label: A new batch: its label, such as W47 (at most 80 characters)
How to split them: the first word is the brand. A 36-character id (8-4-4-4-12 letters and digits) is batchId: resume that batch and ignore the rest. Otherwise it is a new batch: the https:// link is productUrl, the last word (such as W48) is label, and the words between them are productTitle.
2. When a required argument is missing, ask the owner for it and stop.
3. Call the a11 MCP tool `prompt_get` with name `batch` and the arguments by name. Leave out an argument that is not given.
4. Follow the text it returns as the owner's instruction. If it returns an error, tell the owner in one line and stop.
