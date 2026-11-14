import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
 resolve:{alias:{'@tauri-apps/api/core':path.resolve('evidence/guidance-review/native-stub.ts'),'@tauri-apps/api/event':path.resolve('evidence/guidance-review/native-stub.ts')}},
 test:{environment:'jsdom',setupFiles:['desktop/tests/setup.ts'],include:['desktop/tests/unit/guidance-review.test.ts','desktop/tests/unit/bridge-contract.test.ts','desktop/tests/unit/backup-restore.test.ts']},
});
