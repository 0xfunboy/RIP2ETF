import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const clientRoot = resolve(__dirname, '..');
const publicDir = resolve(clientRoot, 'public');
const distDir = resolve(clientRoot, 'dist');

if (!existsSync(publicDir)) {
  console.warn('[client] public/ directory not found. Skipping static asset copy.');
  process.exit(0);
}

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

cpSync(publicDir, distDir, { recursive: true });
console.log('[client] Copied static assets to dist/.');
