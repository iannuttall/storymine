import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/help.test.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  dts: true,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
