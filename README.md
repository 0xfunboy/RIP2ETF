# AIROS Monorepo

AIROS is the all-in-one platform for shipping production-ready, multi-agent AI systems.  
This monorepo contains everything you need to build, operate, and extend AIROS—core runtime,
server, web client, plugins, and tooling.

---

## Why AIROS?

- **Unified runtime** for orchestrating autonomous agents across chat, automation, and analytics.
- **Plugin architecture** that lets you compose capabilities for messaging platforms, LLM providers,
  knowledge sources, and custom actions.
- **Modern web UI** for monitoring conversations, jobs, and long-running workflows.
- **Battle-tested CLI** that automates project scaffolding, deployment, and local development.

---

## Prerequisites

- **Node.js** ≥ 20.11 (23.x recommended for maximum feature coverage)
- **pnpm** ≥ 8 (`npm i -g pnpm`)
- Optional: **Docker** if you plan to run PostgreSQL or other backing services locally

> **Heads-up:** We no longer depend on Bun. All build and runtime tooling now runs through pnpm and Node.js.

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/elizaos/eliza.git airos
cd airos
```

### 2. Install workspace dependencies

```bash
pnpm install
```

### 3. Build everything

```bash
pnpm build
```

### 4. Launch the demo agent

```bash
pnpm start -- --character "./characters/Lamu.character.json"
```

The API server will boot and automatically expose the web UI.  
If port `3000` is in use AIROS will fall back to the next open port (logged at start-up).

---

## Using the AIROS CLI

The CLI lives in `packages/cli` and publishes as `@elizaos/cli`.

### Install locally for development

```bash
pnpm --filter @elizaos/cli build
pnpm --filter @elizaos/cli link --global
```

### One-off execution without installing

```bash
pnpm dlx @elizaos/cli start --character ./characters/Lamu.character.json
```

### Helpful commands

```bash
pnpm --filter @elizaos/cli run start   # build + launch the local server
pnpm --filter @elizaos/cli run test    # execute the CLI test suite
pnpm --filter @elizaos/cli run lint    # auto-format CLI sources
```

> The CLI binary now bootstraps from `bin/elizaos.js`.  
> If the compiled artefacts in `dist/` are missing the wrapper prompts you to run a build first.

---

## Repository Structure

| Directory              | Description                                                |
|------------------------|------------------------------------------------------------|
| `packages/core`        | Core runtime contracts, state management, and utilities    |
| `packages/server`      | API server, message bus, migrations, and web UI bundling   |
| `packages/client`      | React-based operator console                               |
| `packages/cli`         | AIROS CLI source                                           |
| `packages/plugin-*`    | First-party plugins (Discord, Telegram, knowledge, SQL…)   |
| `build-utils.ts`       | Shared build helpers used across packages                  |
| `characters/`          | Sample agent configurations                                |

---

## Development Workflow

```bash
pnpm test             # run all test suites
pnpm lint             # fix formatting across packages
pnpm --filter pkg dev # watch mode for any package (e.g. @elizaos/core)
```

### Launching the full stack

```bash
pnpm --filter @elizaos/server build
pnpm start -- --character "./characters/Lamu.character.json"
```

The server builds the React admin UI automatically and serves it at `/`.

---

## Environment & Secrets

- A root `.env` file controls runtime secrets (ignored by git by default).
- Package-specific secrets should live under `packages/*/.env`—these paths are also ignored.
- Character-specific secrets belong next to the character definition (e.g. `characters/Lamu/*.env`),
  all of which are excluded through the repo `.gitignore`.

Always double-check before pushing that no sensitive `.env` or `*.key` files are staged.

---

## Contributing

1. Fork and clone the repository.
2. Create your feature branch from `develop`.
3. Run `pnpm lint && pnpm test` before pushing.
4. Open a pull request with a clear description and test notes.

Issues and feature requests are welcome—file them on GitHub and tag them with the relevant package.

---

## License

AIROS is released under the [MIT License](./LICENSE).
