---
description: "Read a client's Ads Manager numbers, save them, and write the week report: which ads beat the client's usual CTR and what to try next."
argument-hint: <brand> <reportDate>
---
Run the a11 `results` prompt. Its text lives on the a11 server, so this command always runs the current version.

1. Read the arguments from what the owner typed after the command: $ARGUMENTS
- brand (required): Brand slug (at most 40 characters)
- reportDate (required): The day of the report, YYYY-MM-DD (at most 10 characters)
2. When a required argument is missing, ask the owner for it and stop.
3. Call the a11 MCP tool `prompt_get` with name `results` and the arguments by name. Leave out an argument that is not given.
4. Follow the text it returns as the owner's instruction. If it returns an error, tell the owner in one line and stop.
