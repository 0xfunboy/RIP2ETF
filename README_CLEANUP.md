# RIP2ETF clean-up

This copy removes Docker and Git submodule artifacts and trims the workspace to the essentials.

Removed items:
- packages/cli/Dockerfile
- packages/project-starter/.dockerignore
- packages/project-starter/Dockerfile
- packages/project-starter/docker-compose.yaml
- packages/project-tee-starter/.dockerignore
- packages/project-tee-starter/Dockerfile
- packages/project-tee-starter/docker-compose.yaml
- scripts/init-submodules.sh
- packages/app
- packages/client
- packages/config
- packages/project-starter
- packages/project-tee-starter
- packages/plugin-starter
- packages/plugin-quick-starter
- packages/plugin-dummy-services
- packages/plugin-mcp
- packages/test-utils
- packages/service-interfaces

Root changes:
- Deleted `scripts/init-submodules.sh` and removed `postinstall` hook.
- Set `"packageManager": "pnpm@9.0.0"` in root package.json.
- Centralized TypeScript config: package `tsconfig.json` now `extends` the root `tsconfig.json`.
- Kept only essential packages likely required by CLI + server + selected plugins.
