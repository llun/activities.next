import { execFileSync } from 'node:child_process'
import process from 'node:process'

import {
  getPullRequestsForCommit,
  hasHumanMajorApproval
} from './major-release-approval.mjs'
import { isMajorTransition } from './version-bump-policy.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const nextTag = process.argv[2]
const majorMarker = (subject, body) =>
  /^major:/.test(subject) || /(^|\n)\s*[-*]?\s*major:/.test(body)
const getSourceMainSha = () => {
  const pullRequest = getPullRequestsForCommit(process.env.GITHUB_SHA).find(
    (candidate) => candidate.merged_at
  )
  const match = pullRequest?.body?.match(/^- Base main SHA: `([0-9a-f]{40})`$/m)

  return match?.[1] ?? process.env.GITHUB_SHA
}

const sourceMainSha = getSourceMainSha()
const previousTag = git(
  'tag',
  '--merged',
  sourceMainSha,
  '--list',
  'v[0-9]*',
  '--sort=-v:refname'
).split('\n')[0]

if (!previousTag || !isMajorTransition(previousTag, nextTag)) process.exit(0)

const hashes = git(
  'log',
  `${previousTag}..${sourceMainSha}`,
  '--pretty=format:%H',
  '--no-merges'
)
  .split('\n')
  .filter(Boolean)
const approved = hashes.some((hash) => {
  const subject = git('log', '-1', '--pretty=format:%s', hash)
  const body = git('log', '-1', '--pretty=format:%b', hash)

  return majorMarker(subject, body) && hasHumanMajorApproval(hash)
})

if (!approved) {
  throw new Error(
    `Refusing to create ${nextTag}: major tags require a human-applied release:major label on the source PR`
  )
}
