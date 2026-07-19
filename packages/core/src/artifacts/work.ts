import type {
  Artifact,
  ArtifactLinks,
  ArtifactTopicSignal,
  ArtifactWorkType,
} from './scan.js'

export interface WorkRepository {
  url: string
  visibility: 'unknown'
}

export interface WorkPackage {
  name: string
  private: boolean | null
}

export interface WorkPublication {
  repository: WorkRepository | null
  declaredPublicUrls: string[]
  package: WorkPackage | null
}

export interface RecentWorkItem {
  name: string
  workType: ArtifactWorkType
  score: number
  reasons: string[]
  topics: string[]
  publication: WorkPublication
  commitCount: number | null
  createdFileCount: number
  toolSignals: string[]
  changedAt: string | null
}

export function recentWorkFromArtifacts(
  artifacts: Artifact[],
  limit = 30,
): RecentWorkItem[] {
  const repoRoots = artifacts
    .filter((artifact) => artifact.kind !== 'skill')
    .map((artifact) => artifact.path.replace(/\/+$/, ''))
  const seen = new Set<string>()
  const items = [...artifacts]
    .sort((left, right) => (right.lastChangeMs ?? 0) - (left.lastChangeMs ?? 0))
    .filter((artifact) => {
      const workType = workTypeOf(artifact)
      if (!workType || workType === 'active-project') return false
      if (artifact.kind === 'skill') {
        if (repoRoots.some((root) => artifact.path.startsWith(`${root}/`))) {
          return false
        }
        const key = `skill:${artifact.name.toLowerCase()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }
      const repositoryUrl = publicationOf(artifact).repository?.url
      const key = repositoryUrl
        ? `repo:${repositoryUrl}`
        : `path:${artifact.path}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(recentWorkItem)
    .filter((item) => item.score >= 4)
  return items
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.changedAt ?? '') - Date.parse(left.changedAt ?? '') ||
        left.name.localeCompare(right.name),
    )
    .slice(0, Math.max(1, Math.min(limit, 100)))
}

function recentWorkItem(artifact: Artifact): RecentWorkItem {
  const workType = workTypeOf(artifact) ?? 'active-project'
  const topics = topicsOf(artifact).map((topic) => topic.topic)
  const publication = publicationOf(artifact)
  const commitCount = numberValue(artifact.detail.commitCount)
  const createdFileCount =
    numberValue(artifact.detail.createdFileCount) ??
    stringArray(artifact.detail.createdFiles).length
  const toolSignals = stringArray(artifact.detail.toolSignals)
  const scored = scoreRecentWork({
    name: recentWorkName(artifact),
    workType,
    topics,
    publication,
    commitCount,
    createdFileCount,
    toolSignals,
  })
  return {
    name: recentWorkName(artifact),
    workType,
    score: scored.score,
    reasons: scored.reasons,
    topics,
    publication,
    commitCount,
    createdFileCount,
    toolSignals,
    changedAt:
      artifact.lastChangeMs === null
        ? null
        : new Date(artifact.lastChangeMs).toISOString(),
  }
}

function scoreRecentWork(item: {
  name: string
  workType: ArtifactWorkType
  topics: string[]
  publication: WorkPublication
  commitCount: number | null
  createdFileCount: number
  toolSignals: string[]
}): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score =
    item.workType === 'new-tool'
      ? 5
      : item.workType === 'new-project'
        ? 4
        : item.workType === 'new-feature'
          ? 3
          : 0
  reasons.push(item.workType)
  if ((item.commitCount ?? 0) > 0) {
    score += 1
    reasons.push('recent commits')
  }
  if (item.createdFileCount > 0) {
    score += 1
    reasons.push('files created')
  }
  if (item.toolSignals.length > 0) {
    score += 1.5
    reasons.push('command or skill signal')
  }
  if (item.publication.repository) {
    score += 1
    reasons.push('repository configured')
  }
  if (item.publication.declaredPublicUrls.length > 0) {
    score += 1
    reasons.push('public URL declared')
  }
  if (item.topics.length > 0) {
    score += Math.min(0.75, item.topics.length * 0.25)
    reasons.push('preferred topic match')
  }
  if (
    /(?:^|[-_.])(?:tmp|temp|test|demo|example|scratch|template)(?:[-_.]|$)|\.[a-z0-9]{6}$/i.test(
      item.name,
    )
  ) {
    score -= 3
    reasons.push('temporary or generic project name')
  }
  return { score: Number(score.toFixed(2)), reasons }
}

function recentWorkName(artifact: Artifact): string {
  const repositoryUrl = publicationOf(artifact).repository?.url
  if (!repositoryUrl) return artifact.name
  try {
    const name = new URL(repositoryUrl).pathname
      .split('/')
      .filter(Boolean)
      .at(-1)
    return name || artifact.name
  } catch {
    return artifact.name
  }
}

export function topicsFromArtifacts(artifacts: Artifact[]): string[] {
  return [
    ...new Set(
      artifacts.flatMap((artifact) =>
        topicsOf(artifact).map((topic) => topic.topic),
      ),
    ),
  ]
}

export function publicationFromArtifacts(
  artifacts: Artifact[],
): WorkPublication {
  const publications = artifacts.map(publicationOf)
  return {
    repository:
      publications.find((item) => item.repository)?.repository ?? null,
    declaredPublicUrls: [
      ...new Set(
        publications.flatMap((publication) =>
          publication.declaredPublicUrls.filter(Boolean),
        ),
      ),
    ],
    package: publications.find((item) => item.package)?.package ?? null,
  }
}

export function topicsOf(artifact: Artifact): ArtifactTopicSignal[] {
  if (!Array.isArray(artifact.detail.topics)) return []
  return artifact.detail.topics.filter(isTopicSignal)
}

export function publicationOf(artifact: Artifact): WorkPublication {
  const links = isArtifactLinks(artifact.detail.links)
    ? artifact.detail.links
    : null
  return {
    repository: links?.repositoryUrl
      ? { url: links.repositoryUrl, visibility: 'unknown' }
      : null,
    declaredPublicUrls: links?.publicUrls ?? [],
    package: links?.packageName
      ? { name: links.packageName, private: links.packagePrivate }
      : null,
  }
}

function workTypeOf(artifact: Artifact): ArtifactWorkType | null {
  const value = artifact.detail.workType
  return value === 'new-tool' ||
    value === 'new-project' ||
    value === 'new-feature' ||
    value === 'active-project'
    ? value
    : null
}

function isTopicSignal(value: unknown): value is ArtifactTopicSignal {
  if (!value || typeof value !== 'object') return false
  const signal = value as Record<string, unknown>
  return (
    typeof signal.topic === 'string' &&
    typeof signal.score === 'number' &&
    Array.isArray(signal.matches)
  )
}

function isArtifactLinks(value: unknown): value is ArtifactLinks {
  if (!value || typeof value !== 'object') return false
  const links = value as Record<string, unknown>
  return (
    (links.repositoryUrl === null || typeof links.repositoryUrl === 'string') &&
    Array.isArray(links.publicUrls) &&
    (links.packageName === null || typeof links.packageName === 'string') &&
    (links.packagePrivate === null || typeof links.packagePrivate === 'boolean')
  )
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}
