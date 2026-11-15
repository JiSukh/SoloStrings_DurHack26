import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The board has no internet, so everything the page needs is bundled into
// servo-strummer/assets (gitignored build output, deployed by scripts/deploy.sh).
// Only the optional camera (MediaPipe) and voice (ElevenLabs) reach the internet, at runtime.
export default defineConfig({
  plugins: [svelte()],
  base: './',
  build: { outDir: '../servo-strummer/assets', emptyOutDir: true },
  server: {
    // `npm run dev` with the board forwarded (adb forward tcp:7000 tcp:7000)
    proxy: { '^/(patterns|chords|play|stop|chord|tempo|song|steps|pluck|reset|angles|servos|status|debug|config)(\?.*)?$': 'http://localhost:7000',
             '/socket.io': { target: 'ws://localhost:7000', ws: true } },
  },
  // tests mount components, so Svelte must resolve to its browser build there
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  // Node >= 25 has its own global localStorage (undefined without --localstorage-file), which
  // shadows jsdom's in the test workers; turn it off. Node 22 accepts the flag and ignores it.
  test: { include: ['tests/**/*.test.ts'], execArgv: ['--no-experimental-webstorage'] },
});
