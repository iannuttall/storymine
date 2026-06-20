import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/index.test.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  dts: true,
  sourcemap: true,
})
