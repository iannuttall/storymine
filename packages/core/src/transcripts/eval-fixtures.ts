export type PromptingAlphaFixtureLabel = 'strong' | 'weak'

export interface PromptingAlphaFixture {
  id: string
  label: PromptingAlphaFixtureLabel
  quickTip: string
  alphaType: string
  interventionType: string
  why: string
  examplePrompt: string
}

export const promptingAlphaFixtures: PromptingAlphaFixture[] = [
  {
    id: 'feature-parity-plan-pushback',
    label: 'strong',
    quickTip:
      'Before an AI rebuilds anything, make it produce a feature-parity plan against the old system.',
    alphaType: 'human-steering',
    interventionType: 'pushback',
    why: 'The human caught the agent treating a production replacement like a greenfield MVP and forced a complete parity plan.',
    examplePrompt:
      'Before coding, audit the old system for feature parity. Produce a complete task list with acceptance tests for every old behaviour, then implement one item at a time.',
  },
  {
    id: 'second-pass-existing-behaviour',
    label: 'strong',
    quickTip:
      'When AI proposes a rebuild, ask it to inspect the existing behaviour that affects outcomes.',
    alphaType: 'verification-loop',
    interventionType: 'validation-demand',
    why: 'The useful lesson is not the product detail. It is the prompt move that forces the agent to audit real existing behavior before changing the plan.',
    examplePrompt:
      'Do a second pass against the existing system. Check cadence, ordering, suppressions, retries, and lifecycle states. Tell me exactly what changes in the plan.',
  },
  {
    id: 'audit-working-examples-first',
    label: 'strong',
    quickTip:
      'When an AI keeps breaking a feature, switch from "fix it" to "audit the working examples first."',
    alphaType: 'human-steering',
    interventionType: 'scope-reset',
    why: 'This captures a strong steering moment: stop another blind fix attempt and make the agent compare against known-good examples.',
    examplePrompt:
      'This keeps breaking. Before coding, audit the working versions in these two places, compare the data flow, and tell me exactly what is missing or different.',
  },
  {
    id: 'defaults-over-knobs',
    label: 'strong',
    quickTip:
      'If an AI starts adding lots of configuration, steer it toward strong defaults plus optional overrides.',
    alphaType: 'human-steering',
    interventionType: 'steer',
    why: 'The human pushed the agent toward a simpler product default instead of accepting implementation complexity.',
    examplePrompt:
      'Do not add lots of env vars for this. Pick solid production defaults and only add optional overrides where operators genuinely need control.',
  },
  {
    id: 'post-fix-failure-mode',
    label: 'strong',
    quickTip:
      'After an AI fixes a messy bug, ask what the previous agents were probably missing.',
    alphaType: 'verification-loop',
    interventionType: 'validation-demand',
    why: 'The follow-up question turns a fix into a reusable debugging lesson about the missed failure mode.',
    examplePrompt:
      'What was the actual issue the previous attempts missed? Explain the failure mode, not just the code change.',
  },
  {
    id: 'product-specific-implementation',
    label: 'weak',
    quickTip: 'Use an incremental indexer for transcript processing.',
    alphaType: 'workflow',
    interventionType: 'none',
    why: 'This is an implementation detail unless it is reframed as making AI measure a large data pile before designing.',
    examplePrompt: 'Build an incremental indexer for this transcript tool.',
  },
]
