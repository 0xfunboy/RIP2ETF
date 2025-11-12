import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverRoot = resolve(__dirname, '..');
const clientDistPath = resolve(serverRoot, '../client/dist');
const serverDistPath = resolve(serverRoot, 'dist');
const targetPath = join(serverDistPath, 'client');

if (!existsSync(clientDistPath) || !existsSync(join(clientDistPath, 'index.html'))) {
  console.warn('[STATIC] Client dist not found or missing index.html. Skipping copy.');
  console.warn('[STATIC] Run "pnpm --filter @elizaos/client build" to generate the placeholder UI.');
  process.exit(0);
}

if (!existsSync(serverDistPath)) {
  mkdirSync(serverDistPath, { recursive: true });
}

if (existsSync(targetPath)) {
  rmSync(targetPath, { recursive: true, force: true });
}

cpSync(clientDistPath, targetPath, { recursive: true });
console.log(`[STATIC] Copied client dist to ${targetPath}`);
