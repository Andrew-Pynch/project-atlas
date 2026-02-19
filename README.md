# Project Atlas

Local-first, gamified project OS for personal repos.

## Apps

- `@atlas/web` - interactive 2.5D project universe UI
- `@atlas/api` - local REST API + recommendation orchestration
- `@atlas/mcp` - stdio MCP server for Codex/Claude task tooling

## Quick Start

```bash
bun install
bun run db:init
bun run import:index
bun run local
```

- Web: `http://localhost:3340`
- API: `http://localhost:3341`
- MCP server: `bun run mcp`

## Key Flows

### Import your project inventory

```bash
bun run import:index
# or
bun run import:index -- /absolute/path/to/PROJECT_INDEX.json
```

### Run only MCP

```bash
cd apps/mcp
bun src/server.ts
```

### Install soft startup hooks (Codex + Claude)

```bash
bun run hooks:install
source ~/.zshrc
```

Behavior:
- Hooks only run under `~/personal`
- They fetch a startup recommendation from Atlas API
- All existing args/env flags are preserved
- Bypass once with `--no-atlas-hook`
- Disable globally with `ATLAS_HOOK_BYPASS=1`

### Optional local alias domain

```bash
bun run local-domain:setup
```

This sets `local.projects` in `/etc/hosts`, and if Caddy exists, proxies to `localhost:3340`.

## MCP Client Snippets

Ready-to-copy MCP config snippets:
- `scripts/mcp/project-atlas-mcp.codex.json`
- `scripts/mcp/project-atlas-mcp.claude.json`
