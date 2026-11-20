import { readFileSync } from 'node:fs'

const workflow = readFileSync(
  '.github/workflows/dependabot-auto-merge.yml',
  'utf8'
)

type Step = { name: string; block: string }

const steps = (): Step[] =>
  workflow
    .split(/\n {6}- /)
    .slice(1)
    .map((block) => ({
      name: block.match(/^name: (.*)$/m)?.[1] ?? '',
      block
    }))

const step = (name: string) => {
  const found = steps().find((candidate) => candidate.name === name)
  expect(found, `no step named "${name}"`).toBeTruthy()
  return found as Step
}

// The body of a `run: |` block, so a test can assert what the shell sees.
const runBody = (block: string) => {
  const lines = block.split('\n')
  const start = lines.findIndex((line) => /^\s*run: \|$/.test(line))
  if (start === -1) return ''
  const indent = lines[start].search(/\S/)
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') {
      body.push(line)
      continue
    }
    if (line.search(/\S/) <= indent) break
    body.push(line)
  }
  return body.join('\n')
}

describe('dependabot auto-merge workflow', () => {
  it('runs on pull_request_target with the permissions gh pr merge needs', () => {
    expect(workflow).toContain('on:\n  pull_request_target:\n')
    expect(workflow).toContain(
      'permissions:\n  contents: write\n  pull-requests: write\n'
    )
  })

  it('gates on the PR author being Dependabot and the head being this repo', () => {
    expect(workflow).toContain(
      "github.event.pull_request.user.login == 'dependabot[bot]'"
    )
    expect(workflow).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository'
    )
    expect(workflow).not.toContain('github.actor')
  })

  it('only runs for a PR against the default branch', () => {
    expect(workflow).toContain(
      'github.event.pull_request.base.ref == github.event.repository.default_branch'
    )
  })

  it('checks out the base commit only, without persisted credentials', () => {
    const checkout = step('Checkout the base commit (never the PR head)')

    expect(checkout.block).toContain(
      'ref: ${{ github.event.pull_request.base.sha }}'
    )
    expect(checkout.block).toContain('persist-credentials: false')
    for (const candidate of steps())
      expect(candidate.block).not.toMatch(/^\s*ref: .*head/m)
    expect(workflow).not.toContain('github.head_ref')
  })

  it('fetches the PR head by SHA and reads both lockfiles as data', () => {
    expect(step('Fetch the PR head commit').block).toContain(
      'git fetch --no-tags origin "$HEAD_SHA"'
    )

    const read = step('Read both lockfiles as data').block
    expect(read).toContain('git show "$BASE_SHA:yarn.lock"')
    expect(read).toContain('git show "$HEAD_SHA:yarn.lock"')
    expect(workflow).not.toContain('yarn install')
  })

  it('disables auto-merge first, before any check runs', () => {
    const names = steps().map((candidate) => candidate.name)

    expect(names[0]).toBe('Checkout the base commit (never the PR head)')
    expect(names[1]).toBe('Disable auto-merge until every check passes')

    const body = runBody(
      step('Disable auto-merge until every check passes').block
    )
    expect(body).toContain('set -euo pipefail')
    expect(body).toContain(
      'gh pr view "$PR_URL" --json autoMergeRequest --jq \'.autoMergeRequest != null\''
    )
    expect(body).toContain('gh pr merge --disable-auto "$PR_URL"')
    expect(body).not.toContain('|| true')
  })

  it('verifies sender and commit authorship before reading the PR lockfile', () => {
    const names = steps().map((candidate) => candidate.name)
    const disable = names.indexOf('Disable auto-merge until every check passes')
    const fetch = names.indexOf('Fetch the PR head commit')
    const trusted = names.indexOf(
      "Verify the sender and every commit are Dependabot's"
    )
    const read = names.indexOf('Read both lockfiles as data')
    const check = names.indexOf('Check for new package names')
    const versions = names.indexOf(
      'Check the new versions are at least 7 days old'
    )
    const enable = names.indexOf('Enable auto-merge for Dependabot PRs')
    const review = names.indexOf('Ask a human to review the new packages')

    expect(fetch).toBe(disable + 1)
    expect(trusted).toBe(fetch + 1)
    expect(read).toBeGreaterThan(trusted)
    expect(check).toBeGreaterThan(read)
    expect(versions).toBeGreaterThan(check)
    expect(enable).toBeGreaterThan(versions)
    expect(review).toBeGreaterThan(versions)

    for (const guarded of [
      'Read both lockfiles as data',
      'Check for new package names',
      'Check the new versions are at least 7 days old'
    ]) {
      expect(step(guarded).block).toContain(
        "if: steps.trusted.outputs.ok == 'true'"
      )
    }

    expect(step('Check for new package names').block).toContain(
      'node .github/scripts/lockfile-new-packages.mjs'
    )
  })

  it('checks every new version is at least 7 days old', () => {
    const versions = step('Check the new versions are at least 7 days old')

    expect(versions.block).toContain('id: versions')
    const body = runBody(versions.block)
    expect(body).toContain('--changed-versions')
    expect(body).toContain('npm view --json -- "$locator" time')
    expect(body).toContain('"$age" -lt 7')
    expect(step('Enable auto-merge for Dependabot PRs').block).toContain(
      "steps.versions.outputs.found == 'false'"
    )
    expect(step('Ask a human to review the new packages').block).toContain(
      "steps.versions.outputs.found == 'true'"
    )
  })

  it('decides auto-merge from the trust, package, and version check outputs', () => {
    expect(step('Check for new package names').block).toContain(
      'id: new-packages'
    )
    expect(step('Enable auto-merge for Dependabot PRs').block).toContain(
      "if: steps.trusted.outputs.ok == 'true' && steps.new-packages.outputs.found == 'false' && steps.versions.outputs.found == 'false'"
    )
    expect(step('Ask a human to review the new packages').block).toContain(
      "if: steps.trusted.outputs.ok != 'true' || steps.new-packages.outputs.found == 'true' || steps.versions.outputs.found == 'true'"
    )
  })

  it('verifies the sender and every commit are Dependabot-signed before enabling', () => {
    const trusted = step("Verify the sender and every commit are Dependabot's")

    expect(trusted.block).toContain('SENDER: ${{ github.event.sender.login }}')
    const body = runBody(trusted.block)
    expect(body).toContain('"$SENDER" != \'dependabot[bot]\'')
    expect(body).toContain('git rev-list --count "$BASE_SHA..$HEAD_SHA"')
    expect(body).toContain('"$count" -gt 20')
    expect(body).toContain('for sha in $(git rev-list "$BASE_SHA..$HEAD_SHA")')
    expect(body).toContain(
      'gh api "repos/$GITHUB_REPOSITORY/commits/$sha" --jq \'[.author.login, .commit.verification.verified] | @tsv\''
    )
    expect(body).toContain('"$author" != \'dependabot[bot]\'')
    expect(body).toContain('"$verified" != \'true\'')
    expect(body).not.toContain('pulls/$PR_NUMBER/commits')
    expect(step('Enable auto-merge for Dependabot PRs').block).toContain(
      "steps.trusted.outputs.ok == 'true'"
    )
  })

  it('runs one job per PR and gives up after five minutes', () => {
    expect(workflow).toContain(
      'group: dependabot-auto-merge-${{ github.event.pull_request.number }}'
    )
    expect(workflow).toContain('cancel-in-progress: true')
    expect(workflow).toContain('timeout-minutes: 5')
  })

  it('enables auto-merge only for the head commit it checked', () => {
    expect(step('Enable auto-merge for Dependabot PRs').block).toContain(
      'gh pr merge --auto --squash --match-head-commit "$HEAD_SHA" "$PR_URL"'
    )
  })

  it('leaves auto-merge off in the review step without disabling it again', () => {
    const review = runBody(step('Ask a human to review the new packages').block)

    expect(review).not.toContain('--disable-auto')
    expect(review).toContain('auto-merge is off')
  })

  it('does not echo lockfile content in the review comment when trust verification fails', () => {
    const review = runBody(step('Ask a human to review the new packages').block)
    const untrustedBranch = review.match(
      /if \[ "\$TRUSTED" != 'true' \]; then([\s\S]*?)\belse\b/
    )

    expect(untrustedBranch).toBeTruthy()
    expect(untrustedBranch?.[1]).not.toContain('new-packages.txt')
    expect(untrustedBranch?.[1]).not.toContain('too-new.txt')
  })

  it('never interpolates an expression into a run block', () => {
    for (const candidate of steps())
      expect(runBody(candidate.block), candidate.name).not.toContain('${{')
  })
})
