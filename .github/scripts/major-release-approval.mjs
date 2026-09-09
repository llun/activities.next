import { execFileSync } from 'node:child_process'
import process from 'node:process'

const githubApi = (...args) =>
  JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8' }))
const githubApiPages = (...args) =>
  JSON.parse(
    execFileSync('gh', ['api', '--paginate', '--slurp', ...args], {
      encoding: 'utf8'
    })
  ).flat()

export const hasHumanMajorLabelEvent = (pullRequest, events) => {
  if (
    !pullRequest.merged_at ||
    !pullRequest.labels.some((label) => label.name === 'release:major')
  ) {
    return false
  }

  const latestLabelEvent = events
    .filter(
      (event) =>
        ['labeled', 'unlabeled'].includes(event.event) &&
        event.label?.name === 'release:major'
    )
    .sort(
      (left, right) =>
        Date.parse(right.created_at) - Date.parse(left.created_at) ||
        Number(right.id) - Number(left.id)
    )[0]

  return (
    latestLabelEvent?.event === 'labeled' &&
    latestLabelEvent.actor?.type === 'User'
  )
}

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

    const events = githubApiPages(
      `repos/${process.env.GITHUB_REPOSITORY}/issues/${pullRequest.number}/events?per_page=100`
    )
    return hasHumanMajorLabelEvent(pullRequest, events)
  })
}
