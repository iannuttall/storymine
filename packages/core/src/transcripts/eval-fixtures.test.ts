import assert from 'node:assert/strict'
import test from 'node:test'
import { promptingAlphaFixtures } from './eval-fixtures.js'

test('prompting alpha fixtures include intervention examples', () => {
  const strong = promptingAlphaFixtures.filter(
    (fixture) => fixture.label === 'strong',
  )
  const weak = promptingAlphaFixtures.filter(
    (fixture) => fixture.label === 'weak',
  )

  assert.ok(strong.length >= 5)
  assert.ok(weak.length >= 1)
  assert.ok(strong.some((fixture) => fixture.interventionType === 'pushback'))
  assert.ok(strong.some((fixture) => fixture.interventionType === 'steer'))
  assert.ok(
    strong.some((fixture) => fixture.interventionType === 'scope-reset'),
  )
  assert.ok(
    strong.some((fixture) => fixture.interventionType === 'validation-demand'),
  )
  assert.ok(strong.some((fixture) => fixture.skillPotential === 'ui'))
  assert.ok(strong.some((fixture) => fixture.skillPotential === 'performance'))
})

test('prompting alpha fixtures are newsletter-safe examples', () => {
  for (const fixture of promptingAlphaFixtures) {
    assert.match(fixture.id, /^[a-z0-9-]+$/)
    assert.ok(fixture.quickTip.length > 20)
    assert.ok(fixture.quickTip.length <= 140)
    assert.ok(fixture.why.length > 20)
    assert.ok(fixture.plainEnglishWhy.length > 20)
    assert.ok(fixture.examplePrompt.length > 20)
    assert.doesNotMatch(fixture.quickTip, /this repo|this project/i)
    assert.doesNotMatch(fixture.quickTip, /not just/i)
    assert.doesNotMatch(fixture.examplePrompt, /\/Users\//)
  }
})
