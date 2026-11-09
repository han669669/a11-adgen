---
description: "Start a batch that beats a live ad: the server keeps the ad's pictures, you study them, then the batch runs as usual."
argument-hint: <brand> <adImageUrls> <title> <label> [adUrl]
---
Run the a11 `redesign` prompt. Its text lives on the a11 server, so this command always runs the current version.

1. Read the arguments from what the owner typed after the command: $ARGUMENTS
- brand (required): Brand slug
- adImageUrls (required): Direct https links to the live ad's pictures, separated by spaces (up to 6)
- title (required): A short name for the ad
- label (required): The batch label, such as W48
- adUrl: The page where the ad runs, if there is one
2. When a required argument is missing, ask the owner for it and stop.
3. Call the a11 MCP tool `prompt_get` with name `redesign` and the arguments by name. Leave out an argument that is not given.
4. Follow the text it returns as the owner's instruction. If it returns an error, tell the owner in one line and stop.
