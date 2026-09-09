import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import process from 'node:process'

import { nextVersion, selectVersionBump } from './version-bump-policy.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const output = (name, value) =>
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
const majorMarker = (subject, body) =>
  /^major:/.test(subject) || /(^|\n)\s*[-*]?\s*major:/.test(body)

const hasHumanMajorApproval = (hash) => {
  try {
    const pullRequests = JSON.parse(
      execFileSync(
        'gh',
        ['api', `repos/${process.env.GITHUB_REPOSITORY}/commits/${hash}/pulls`],
        { encoding: 'utf8' }
      )
    )
    return pullRequests.some(
      (pullRequest) =>
        pullRequest.merged_at &&
        pullRequest.labels.some((label) => label.name === 'release:major')
    )
  } catch {
    // Fail closed: without the maintainer approval record, a major marker is
    // intentionally treated as a minor release request.
    return false
  }
}

const baseSha = git('rev-parse', 'origin/main')
output('base_sha', baseSha)

if (process.env.GITHUB_SHA !== baseSha) {
  output('new_version', '')
  process.exit(0)
}

const headMessage = git('log', '-1', '--pretty=format:%s', baseSha)
if (/^Bump version to v\d+\.\d+\.\d+/.test(headMessage)) {
  output('new_version', '')
  process.exit(0)
}

git('checkout', '--detach', baseSha)
const latestTag = git(
  'tag',
  '--merged',
  'HEAD',
  '--list',
  'v[0-9]*',
  '--sort=-v:refname'
).split('\n')[0]

if (!latestTag) {
  output('bump', 'initial')
  output('commit_count', '0')
  output('latest_tag', '')
  output('new_version', '1.0.0')
  process.exit(0)
}

output('latest_tag', latestTag)
const hashes = git(
  'log',
  `${latestTag}..HEAD`,
  '--pretty=format:%H',
  '--no-merges'
)
  .split('\n')
  .filter(Boolean)

if (hashes.length === 0) {
  output('new_version', '')
  process.exit(0)
}

const commits = hashes.map((hash) => {
  const subject = git('log', '-1', '--pretty=format:%s', hash)
  const body = git('log', '-1', '--pretty=format:%b', hash)
  return {
    subject,
    body,
    changedFiles: git(
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      '--root',
      hash
    )
      .split('\n')
      .filter(Boolean),
    majorApproved: majorMarker(subject, body) && hasHumanMajorApproval(hash)
  }
})

const { bump, commitCount } = selectVersionBump(commits)
output('bump', bump)
output('commit_count', String(commitCount))
output('new_version', bump === 'none' ? '' : nextVersion(latestTag, bump))
