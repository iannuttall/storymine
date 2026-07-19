import { defineConfig } from 'tsup'

const bundledWorkspacePackages = [/^@research\//]

export default defineConfig([
  {
    entry: {
      index: 'packages/core/src/index.ts',
      mcp: 'packages/mcp/src/index.ts',
    },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    clean: true,
    dts: true,
    sourcemap: true,
    noExternal: bundledWorkspacePackages,
  },
  {
    entry: { cli: 'packages/cli/src/index.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    clean: false,
    dts: false,
    sourcemap: true,
    minify: true,
    noExternal: bundledWorkspacePackages,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
])
