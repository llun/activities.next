import { execFileSync } from 'node:child_process'
import process from 'node:process'

const githubApi = (...args) =>
  JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8' }))

export const hasHumanMajorLabelEvent = (pullRequest, events) =>
  Boolean(pullRequest.merged_at) &&
  pullRequest.labels.some((label) => label.name === 'release:major') &&
  events.some(
    (event) =>
      event.event === 'labeled' &&
      event.label?.name === 'release:major' &&
      event.actor?.type === 'User'
  )

export const hasHumanMajorApproval = (hash) => {
  const pullRequests = githubApi(
    `repos/${process.env.GITHUB_REPOSITORY}/commits/${hash}/pulls`
  )

  return pullRequests.some((pullRequest) => {
    if (
      !pullRequest.merged_at ||
      !pullRequest.labels.some((label) => label.name === 'release:major')
    ) {
      return false
    }

    const events = githubApi(
      `repos/${process.env.GITHUB_REPOSITORY}/issues/${pullRequest.number}/events?per_page=100`
    )
    return hasHumanMajorLabelEvent(pullRequest, events)
  })
}

export const getPullRequestsForCommit = (hash) =>
  githubApi(`repos/${process.env.GITHUB_REPOSITORY}/commits/${hash}/pulls`)
