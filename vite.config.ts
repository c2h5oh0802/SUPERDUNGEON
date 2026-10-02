import { defineConfig } from 'vitest/config';
import { execFileSync } from 'node:child_process';

// Build identity is bundled by the build, never taken from visitor input.
const commit = process.env.VERCEL_GIT_COMMIT_SHA || (() => {
  try { return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'local'; }
})();

// base './' 讓 dist/ 可以放在任意子路徑的靜態主機上。
export default defineConfig({
  base: './',
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(`0.1.0-${commit.slice(0,12)}`) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
