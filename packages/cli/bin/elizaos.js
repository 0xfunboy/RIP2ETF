#!/usr/bin/env node

/**
 * Wrapper entry point used during development.
 * Ensures the built CLI artefact exists before delegating to it.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(__dirname, '../dist/index.js');

if (!existsSync(distEntry)) {
  console.error(
    'AIROS CLI build output not found.\n' +
      'Run "pnpm --filter @elizaos/cli build" to generate the dist artefacts before invoking the CLI.'
  );
  process.exit(1);
}

const args = [distEntry, ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 0;
