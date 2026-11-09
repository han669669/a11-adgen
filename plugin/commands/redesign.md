---
description: "Start a batch that beats a live ad: the server keeps the ad's pictures, you study them, then the batch runs as usual."
argument-hint: <brand> <adImageUrls> <title> <label> [adUrl]
---
Run the a11 `redesign` prompt. Its text lives on the a11 server, so this command always runs the current version.

1. Read the arguments from what the owner typed after the command: $ARGUMENTS
- brand (required): Brand slug (at most 40 characters)
- adImageUrls (required): Direct https links to the live ad's pictures, separated by spaces (up to 6, each at most 2000 characters)
- title (required): A short name for the ad (at most 160 characters)
- label (required): The batch label, such as W48 (at most 80 characters)
- adUrl: The page where the ad runs, if there is one (at most 2000 characters)
How to split them: the first word is the brand. Then come the picture links (each starts with https://), then the title, then the label (such as W48). An https:// link after the label is adUrl, not a picture. If the title or the label is not clear, ask the owner.
2. When a required argument is missing, ask the owner for it and stop.
3. Call the a11 MCP tool `prompt_get` with name `redesign` and the arguments by name. Leave out an argument that is not given.
4. Follow the text it returns as the owner's instruction. If it returns an error, tell the owner in one line and stop.
