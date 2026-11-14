import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({resolve:{alias:{'@tauri-apps/api/core':path.resolve('evidence/personal-reference/native-stub.ts'),'@tauri-apps/api/event':path.resolve('evidence/personal-reference/native-stub.ts')}},test:{environment:'jsdom',setupFiles:['desktop/tests/setup.ts'],include:['desktop/tests/unit/manual-reference-editor.test.tsx']}});
