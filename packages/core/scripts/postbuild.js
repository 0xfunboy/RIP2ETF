import { cpSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ensureDir = (path) => {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
};

ensureDir('dist/node');
ensureDir('dist/browser');

writeFileSync('dist/node/index.node.js', `export * from '../index.js';\n`);
writeFileSync('dist/browser/index.browser.js', `export * from '../index.js';\n`);

const copies = [
  { src: 'dist/index.d.ts', dest: 'dist/node/index.d.ts' },
  { src: 'dist/index.d.ts', dest: 'dist/browser/index.d.ts' },
  { src: 'dist/index.d.cts', dest: 'dist/node/index.d.cts' },
  { src: 'dist/index.d.cts', dest: 'dist/browser/index.d.cts' }
];

for (const { src, dest } of copies) {
  if (!existsSync(src)) {
    console.warn(`[core postbuild] Skipping copy; missing ${src}`);
    continue;
  }
  const dir = dirname(dest);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  cpSync(src, dest);
}
