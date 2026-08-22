# CLAUDE.md — Growspace workspace hub

@AGENTS.md

The import above is canonical: the directory map, the runtime commands, the
validation levels, worktree workflow, and the cross-repo contract. Read it first.

## Claude Code specifics

- Opening a session here gives you the hub only. To work on code, either `cd`
  into a repo, or add both:
  ```bash
  claude --add-dir ../growspace_manager --add-dir ../lovelace-growspace-manager-card
  ```
  Set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` so each repo's own
  `CLAUDE.md`/`AGENTS.md` loads too — otherwise you get their files but not
  their instructions.
- **Use the browser tools against `http://localhost:8123`** to verify real
  behaviour. It is an ordinary local web app: navigate it, read its console, and
  screenshot it. This is the whole reason the runtime is not inside a
  devcontainer.
- When something fails at runtime, read `ha-dev/home-assistant.log` directly
  before theorising.
- Use plan mode for anything spanning both repos.
