import assert from 'node:assert/strict'
import test from 'node:test'
import type { Artifact } from './scan.js'
import { recentWorkFromArtifacts } from './work.js'

test('recentWorkFromArtifacts returns portable evidence without local paths', () => {
  const artifact: Artifact = {
    kind: 'new-repo',
    path: '/Users/private/dev/cli/site-checker',
    name: 'site-checker',
    firstChangeMs: 1,
    lastChangeMs: Date.parse('2026-07-19T10:00:00.000Z'),
    detail: {
      workType: 'new-tool',
      commitCount: 3,
      createdFiles: ['src/index.ts', 'package.json'],
      createdFileCount: 2,
      toolSignals: ['command:site-checker'],
      topics: [{ topic: 'SEO', score: 0.9, matches: ['seo'] }],
      links: {
        repositoryUrl: 'https://github.com/example/site-checker',
        publicUrls: ['https://site-checker.example'],
        packageName: 'site-checker',
        packagePrivate: false,
      },
    },
  }

  const result = recentWorkFromArtifacts([artifact])

  assert.deepEqual(result, [
    {
      name: 'site-checker',
      workType: 'new-tool',
      score: 10.75,
      reasons: [
        'new-tool',
        'recent commits',
        'files created',
        'command or skill signal',
        'repository configured',
        'public URL declared',
        'preferred topic match',
      ],
      topics: ['SEO'],
      publication: {
        repository: {
          url: 'https://github.com/example/site-checker',
          visibility: 'unknown',
        },
        declaredPublicUrls: ['https://site-checker.example'],
        package: { name: 'site-checker', private: false },
      },
      commitCount: 3,
      createdFileCount: 2,
      toolSignals: ['command:site-checker'],
      changedAt: '2026-07-19T10:00:00.000Z',
    },
  ])
  assert.doesNotMatch(JSON.stringify(result), /Users\/private/)
})
