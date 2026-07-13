import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function copyManifest(): Plugin {
  return {
    name: 'pointask-copy-manifest',
    closeBundle() {
      mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, 'dist/manifest.json'),
      );
      for (const file of ['settings.html', 'privacy.html']) {
        copyFileSync(resolve(__dirname, file), resolve(__dirname, 'dist', file));
      }
    },
  };
}

function verifyExtensionScriptEncoding(): Plugin {
  return {
    name: 'pointask-verify-script-encoding',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        output.code = output.code.replace(/\P{ASCII}/gu, (character) => {
          const codePoint = character.codePointAt(0)!;
          return codePoint <= 0xffff
            ? `\\u${codePoint.toString(16).padStart(4, '0')}`
            : `\\u{${codePoint.toString(16)}}`;
        });
      }
    },
    closeBundle() {
      for (const file of ['content.js', 'background.js', 'settings.js']) {
        const path = resolve(__dirname, 'dist', file);
        try {
          const bytes = readFileSync(path);
          if (bytes.some((byte) => byte > 0x7f)) throw new Error(`${file} is not ASCII-safe`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const target = mode === 'background' ? 'background' : mode === 'settings' ? 'settings' : 'content';

  return {
    plugins: [react(), copyManifest(), verifyExtensionScriptEncoding()],
    build: {
      outDir: 'dist',
      emptyOutDir: mode === 'content',
      rollupOptions: {
        input: resolve(__dirname, `src/${target}/index.ts`),
        output: {
          inlineDynamicImports: true,
          entryFileNames: `${target}.js`,
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    test: {
      environment: 'jsdom',
      environmentOptions: {
        jsdom: { url: 'https://chatgpt.com/c/local-fixture' },
      },
    },
  };
});
