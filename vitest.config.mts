import { defineConfig } from 'vitest/config';
export default defineConfig({
 resolve:{alias:{'server-only':new URL('./scripts/server-only-test.ts',import.meta.url).pathname}},
 test:{include:['packages/**/*.test.ts','apps/web/lib/**/*.test.ts'],testTimeout:20000},
});
