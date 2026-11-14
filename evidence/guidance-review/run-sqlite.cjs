const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const config = path.join(root, 'mobile/tsconfig.json');
const original = fs.readFileSync(config);
try {
  // This storage-only harness uses the unmodified Node SQLite adapter and shared
  // vectors. Expo is absent here, so bypass its compiler preset for this run.
  fs.writeFileSync(config, JSON.stringify({compilerOptions:{target:'ES2022',jsx:'react-jsx'}}));
  const result = cp.spawnSync(process.execPath, [path.join(root,'website/node_modules/vitest/vitest.mjs'),'run','--config','evidence/guidance-review/sqlite.config.ts'], {cwd:root,stdio:'inherit'});
  process.exitCode = result.status ?? 1;
} finally { fs.writeFileSync(config, original); }
