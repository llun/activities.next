import { execFileSync } from 'node:child_process'
import process from 'node:process'

import { isMajorTransition } from './version-bump-policy.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const nextTag = process.argv[2]
const previousTag = git(
  'tag',
  '--merged',
  'HEAD^',
  '--list',
  'v[0-9]*',
  '--sort=-v:refname'
).split('\n')[0]

if (!previousTag || !isMajorTransition(previousTag, nextTag)) process.exit(0)

const pullRequests = JSON.parse(
  execFileSync(
    'gh',
    [
      'api',
      `repos/${process.env.GITHUB_REPOSITORY}/commits/${process.env.GITHUB_SHA}/pulls`
    ],
    { encoding: 'utf8' }
  )
)
const approved = pullRequests.some(
  (pullRequest) =>
    pullRequest.merged_at &&
    pullRequest.labels.some((label) => label.name === 'release:major')
)

if (!approved) {
  throw new Error(
    `Refusing to create ${nextTag}: major tags require the human-applied release:major label`
  )
}
