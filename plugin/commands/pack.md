---
description: "Build the client pack from the finals the owner approved: the right final for each pick, box print for a boxed product, the Meta text, then the private pack link (sent to no one)."
argument-hint: <batchId>
---
Run the a11 `pack` prompt. Its text lives on the a11 server, so this command always runs the current version.

1. Read the arguments from what the owner typed after the command: $ARGUMENTS
- batchId (required): The batch id (36 characters)
2. When a required argument is missing, ask the owner for it and stop.
3. Call the a11 MCP tool `prompt_get` with name `pack` and the arguments by name. Leave out an argument that is not given.
4. Follow the text it returns as the owner's instruction. If it returns an error, tell the owner in one line and stop.
