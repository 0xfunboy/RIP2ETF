#!/usr/bin/env bash
set -euo pipefail

echo ">>> 0) Prerequisiti workspace"
# .npmrc per evitare blocchi di peer deps e hoist utile a tsup/esbuild
cat > .npmrc <<'RC'
strict-peer-dependencies=false
auto-install-peers=true
public-hoist-pattern[]=*esbuild*
public-hoist-pattern[]=*tsup*
public-hoist-pattern[]=@swc/core
RC

echo ">>> 1) Allinea dipendenze chiave a livello workspace"
pnpm add -D -w @types/node@24
# Zod v3 coerente con i peer (evita mismatch)
node - <<'NODE'
const fs=require('fs'),path=require('path');
const files=[];
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name);
  if(e.isDirectory()) walk(p);
  else if(e.isFile() && e.name==='package.json') files.push(p);
}}
if (fs.existsSync('packages')) walk('packages');
files.push('package.json');
for (const p of files){
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  for (const sec of ['dependencies','devDependencies','peerDependencies','optionalDependencies']){
    if (j[sec]?.zod) j[sec].zod='^3.23.8';
  }
  fs.writeFileSync(p, JSON.stringify(j,null,2));
}
console.log('OK: zod@^3.23.8 in tutto il workspace');
NODE

echo ">>> 2) tsconfig root e per-package"
# Root tsconfig: lib + types node, niente paths/incremental
node - <<'NODE'
const fs=require('fs');
const p='tsconfig.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.compilerOptions ||= {};
j.compilerOptions.lib = Array.from(new Set([...(j.compilerOptions.lib||[]), 'ES2022']));
j.compilerOptions.types = Array.from(new Set([...(j.compilerOptions.types||[]), 'node']));
j.compilerOptions.incremental = false;
j.compilerOptions.composite = false;
j.compilerOptions.skipLibCheck = true;
j.compilerOptions.baseUrl = '.';
if (j.compilerOptions.paths) delete j.compilerOptions.paths;
if ('declaration' in j.compilerOptions) delete j.compilerOptions.declaration;
if ('declarationMap' in j.compilerOptions) delete j.compilerOptions.declarationMap;
fs.writeFileSync(p, JSON.stringify(j,null,2));
console.log('OK: tsconfig root');
NODE

# tsconfig per ogni pacchetto; per core includiamo anche DOM per `window` in logger.ts
find packages -maxdepth 1 -mindepth 1 -type d | while read -r pkg; do
  if [ "$(basename "$pkg")" = "core" ]; then
    cat > "$pkg/tsconfig.json" <<'JSON'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022","DOM"],
    "types": ["node"],
    "composite": false,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts","src/**/*.tsx","index.ts","bin/**/*.ts","scripts/**/*.ts"],
  "exclude": ["node_modules","dist","build","**/*.test.ts","**/__tests__/**"]
}
JSON
  else
    cat > "$pkg/tsconfig.json" <<'JSON'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": false,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts","src/**/*.tsx","index.ts","bin/**/*.ts","scripts/**/*.ts"],
  "exclude": ["node_modules","dist","build","**/*.test.ts","**/__tests__/**"]
}
JSON
  fi
done
echo "OK: tsconfig per-package scritti"

echo ">>> 3) Patch codice compatibilità (Zod v3 + Node timers)"
# z.enum(X) -> z.nativeEnum(X) quando X è un enum TS
grep -RIl --include='*.ts' -E 'z\.enum\s*\(\s*(ChannelType|MessageRole|MessageType|RoleType)\s*\)' packages \
  | xargs -r sed -i -E 's/z\.enum\s*\(\s*([A-Za-z0-9_]+)\s*\)/z.nativeEnum(\1)/g'

# Se ChannelType NON è un enum TS ma un oggetto string->string, fallback su array di valori nel character schema
if grep -q "packages/core/src/schemas/character.ts" <(echo packages/core/src/schemas/character.ts 2>/dev/null); then
  sed -i -E 's/z\.nativeEnum\(ChannelType\)/z.enum(Object.values(ChannelType) as [string, ...string[]])/g' packages/core/src/schemas/character.ts || true
fi

# Timer -> ReturnType<typeof setTimeout> nel plugin-mcp
grep -Rnw packages/plugin-mcp/src -e '\bTimer\b' || true
sed -i -E 's/\bTimer\b/ReturnType<typeof setTimeout>/g' packages/plugin-mcp/src/**/*.ts 2>/dev/null || true
sed -i -E "s#import\\s*\\{\\s*setTimeout\\s*,\\s*clearTimeout\\s*\\}\\s*from\\s*'timers'\\s*;##" packages/plugin-mcp/src/**/*.ts 2>/dev/null || true

echo ">>> 4) Hardening logger (tipi DOM al volo)"
# Aggiunge una sola volta il riferimento DOM in cima per evitare TS2304 su window in dts
if [ -f packages/core/src/logger.ts ]; then
  head -n1 packages/core/src/logger.ts | grep -q 'reference lib="dom"' || \
    sed -i '1s/^/\/\/\/ <reference lib="dom" \/>\n/' packages/core/src/logger.ts
fi

echo ">>> 5) Ripristino pacchetto client minimale, se manca"
if [ ! -f packages/client/package.json ]; then
  mkdir -p packages/client/src
  cat > packages/client/package.json <<'JSON'
{
  "name": "@elizaos/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "sideEffects": false,
  "scripts": {
    "build": "tsup src/index.ts --dts --format esm,cjs",
    "dev": "tsup src/index.ts --watch"
  },
  "dependencies": {
    "@elizaos/api-client": "workspace:*"
  },
  "devDependencies": {}
}
JSON
  cat > packages/client/src/index.ts <<'TS'
// re-export minimale per soddisfare i consumer del workspace
export * from '@elizaos/api-client';
TS
fi

echo ">>> 6) Install + build monorepo"
pnpm install
pnpm -r build

echo ">>> COMPLETATO. Avvio suggerito:"
echo 'pnpm start -- --character "$PWD/characters/RIP.character.json"'
