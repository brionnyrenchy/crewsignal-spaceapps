import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({resolve:{alias:{'@jest/globals':path.resolve('website/node_modules/vitest/dist/index.js')}},test:{environment:'node',include:['mobile/tests/manual-reference.test.ts','mobile/tests/sqlite-transactions.test.ts']}});
