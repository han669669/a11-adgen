---
description: "Make or update a brand kit from the brand's website."
argument-hint: <url> <slug>
---
Run the a11 `brand` prompt. Its text lives on the a11 server, so this command always runs the current version.

1. Read the arguments from what the owner typed after the command: $ARGUMENTS
- url (required): The brand's home page
- slug (required): Short lowercase name for the brand, such as wongi
2. When a required argument is missing, ask the owner for it and stop.
3. Call the a11 MCP tool `prompt_get` with name `brand` and the arguments by name. Leave out an argument that is not given.
4. Follow the text it returns as the owner's instruction. If it returns an error, tell the owner in one line and stop.
