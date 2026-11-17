import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'public/manifest.json',
          dest: '.',
        },
        {
          src: 'public/rules.json',
          dest: '.',
        }
      ],
    }),
  ],
  build: {
    outDir: 'build',
    rollupOptions: {
      input: {
        main: './index.html',
        content: './src/content.ts',
        background: './src/background.ts',
      },
      output: {
        // The content script can be injected twice into a tab (manifest + re-injection after an
        // extension reload). Wrap it so its top-level consts don't collide.
        banner: (chunk) => (chunk.name === 'content' ? '(() => {' : ''),
        footer: (chunk) => (chunk.name === 'content' ? '})();' : ''),
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'content') return 'content.js';
          if (chunkInfo.name === 'background') return 'background.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});