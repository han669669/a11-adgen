---
description: "Judge the gold set blind and compare with the owner's marks."
argument-hint: <note>
---
Run the a11 `gold-test` prompt. Its text lives on the a11 server, so this command always runs the current version.

1. Read the arguments from what the owner typed after the command: $ARGUMENTS
- note (required): What this run tests, such as 'before canon change X'
2. When a required argument is missing, ask the owner for it and stop.
3. Call the a11 MCP tool `prompt_get` with name `gold-test` and the arguments by name. Leave out an argument that is not given.
4. Follow the text it returns as the owner's instruction. If it returns an error, tell the owner in one line and stop.
