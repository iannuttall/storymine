import type { StoryFields } from './story-ranking.js'

export type StoryEvalLabel = 'strong' | 'weak'

export interface StoryEvalFixture {
  id: string
  label: StoryEvalLabel
  title: string
  fields: StoryFields
  reason: string
}

export const storyEvalFixtures: StoryEvalFixture[] = [
  {
    id: 'geometry-over-auto-tracing',
    label: 'strong',
    title: 'Rebuilt a raster logo from measured geometry',
    fields: {
      concreteProblem:
        'A 960x838 antialiased PNG logo had no source vector, and automatic tracing produced hundreds of noisy SVG points.',
      failedApproaches:
        'Automatic tracing in trace.py created path soup, while threshold masks damaged the soft curved caps.',
      nonObviousMove:
        'The working approach measured circles and shared slopes in measure.py, then rebuilt the intended shape instead of tracing pixels.',
      reusableRecipe:
        'Render output.svg, compare it with the source in metrics.py, tune shared geometry, and repeat until the edges align.',
      evidence:
        'The final SVG reached 0.998 silhouette IoU and 0.21px mean edge distance across 370175 pixels.',
    },
    reason: 'Specific failure, method, reusable loop, and measured proof.',
  },
  {
    id: 'restartable-session-index',
    label: 'strong',
    title: 'Made a long transcript audit resume after interruption',
    fields: {
      concreteProblem:
        'A transcript audit over 1200 SQLite chunks lost completed model work whenever the process was stopped halfway through.',
      failedApproaches:
        'The first audit loop kept results only in memory and restarted every chunk after a timeout or manual stop.',
      nonObviousMove:
        'Each model result was written to storymine.db immediately, and chunks received pending, audited, or failed status before the next call.',
      reusableRecipe:
        'Give every expensive item a durable status, save each successful result immediately, and retry only pending or failed rows on restart.',
      evidence:
        'Stopping and rerunning the audit skipped completed SQLite rows and continued from the first pending chunk.',
    },
    reason:
      'Turns a technical design into a reusable workflow with observable proof.',
  },
  {
    id: 'progressive-fix-guidance',
    label: 'strong',
    title: 'Kept audit reports small while making every failure actionable',
    fields: {
      concreteProblem:
        'An SEO CLI returned 23 structured crawler checks, but agents still needed complete fix instructions and source links for each failed check.',
      failedApproaches:
        'Putting every fix into each JSON result made reports noisy, while creating 23 separate SKILL.md files produced repetitive routing work.',
      nonObviousMove:
        'The implementation separated compact findings from a keyed check-fixes.ts registry that agents queried only after one check failed.',
      reusableRecipe:
        'Keep the normal result compact, key detailed remediation by stable check ID, and expose one describe command for progressive lookup.',
      evidence:
        'Commit 2ff429b added the registry and describe command, and all four test suites passed with zero failures.',
    },
    reason:
      'A specific product decision with two rejected designs, reusable architecture, and commit evidence.',
  },
  {
    id: 'campaign-segment-debugger',
    label: 'strong',
    title: 'Found the landing-page segment hiding a campaign conversion win',
    fields: {
      concreteProblem:
        'A campaign-report.ts summary blended branded and non-branded landing pages, hiding which page group changed after launch.',
      failedApproaches:
        'The first aggregate report failed to explain the movement because one high-volume branded page dominated every average.',
      nonObviousMove:
        'The useful move separated landing pages by query intent before comparing the pre-launch and post-launch windows.',
      reusableRecipe:
        'Export both periods, assign each landing page to a deterministic intent segment, and compare segment rates before inspecting individual pages.',
      evidence:
        'The segmented report isolated a 17% conversion-rate increase in the non-branded group across 42 landing pages.',
    },
    reason:
      'A marketing observation tied to a concrete analysis method and measurable evidence.',
  },
  {
    id: 'generic-verification-advice',
    label: 'weak',
    title: 'Make AI verify its work',
    fields: {
      concreteProblem: 'The AI made mistakes while coding the project.',
      failedApproaches: 'Several attempts did not work very well.',
      nonObviousMove: 'Make the AI verify its work before continuing.',
      reusableRecipe: 'Write tests and review the output carefully every time.',
      evidence: 'The result was better after checking it.',
    },
    reason:
      'Could be written without seeing the work and has no concrete proof.',
  },
  {
    id: 'routine-package-change',
    label: 'weak',
    title: 'Updated a package dependency',
    fields: {
      concreteProblem: 'A package needed to be updated in package.json.',
      failedApproaches: 'The old package version was no longer current.',
      nonObviousMove: 'Changed the version and installed the package.',
      reusableRecipe:
        'Run npm install and check that the project still builds.',
      evidence: 'The package file changed and the build passed.',
    },
    reason: 'Routine maintenance with no non-obvious lesson.',
  },
  {
    id: 'detailed-project-summary',
    label: 'weak',
    title: 'Updated the crawler documentation and command examples',
    fields: {
      concreteProblem:
        'README.md did not mention the flags exposed by crawler.ts and users needed current command examples.',
      failedApproaches:
        'The old README.md examples were out of date after the previous release.',
      nonObviousMove:
        'The command names from crawler.ts were copied into README.md with their current flags.',
      reusableRecipe:
        'Write the current command examples into README.md and keep them aligned with crawler.ts.',
      evidence:
        'The documentation build passed and README.md contained the new examples.',
    },
    reason:
      'Concrete project work, but still routine documentation with no real failure or insight.',
  },
  {
    id: 'unverified-public-repo',
    label: 'weak',
    title: 'Published a local tool because Git had a remote URL',
    fields: {
      concreteProblem:
        'package.json had a repository field, but the local audit could not tell whether the remote repository was public.',
      failedApproaches:
        'The first check could not distinguish a configured private remote from a publicly reachable GitHub repository.',
      nonObviousMove:
        'The report copied the value returned by git remote get-url origin into its output.',
      reusableRecipe:
        'Read the Git remote from .git/config and print it beside the package name.',
      evidence:
        'The git command printed https://github.com/example/private-tool from the local checkout.',
    },
    reason:
      'A configured link is useful evidence, but it cannot support a publication claim.',
  },
]
