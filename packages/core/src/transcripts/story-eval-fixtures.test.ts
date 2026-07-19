import assert from 'node:assert/strict'
import test from 'node:test'
import { storyEvalFixtures } from './story-eval-fixtures.js'
import { validateStoryFields } from './story-ranking.js'

test('story quality fixtures agree with the deterministic gate', () => {
  assert.ok(storyEvalFixtures.length >= 4)
  for (const fixture of storyEvalFixtures) {
    const validation = validateStoryFields(fixture.fields, fixture.title)
    assert.equal(
      validation.ok,
      fixture.label === 'strong',
      `${fixture.id}: ${validation.reasons.join('; ')}`,
    )
  }
})

test('story quality fixtures are safe to commit', () => {
  const text = JSON.stringify(storyEvalFixtures)
  assert.doesNotMatch(text, /\/Users\//)
  assert.doesNotMatch(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)
  assert.doesNotMatch(text, /(?:sk|pk|rk)-[A-Za-z0-9_-]{20,}/)
})
