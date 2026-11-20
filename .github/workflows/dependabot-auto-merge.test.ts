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

  it('checks for new packages before it decides about auto-merge', () => {
    const names = steps().map((candidate) => candidate.name)
    const check = names.indexOf('Check for new package names')
    const enable = names.indexOf('Enable auto-merge for Dependabot PRs')
    const review = names.indexOf('Ask a human to review the new packages')

    expect(check).toBeGreaterThan(-1)
    expect(enable).toBeGreaterThan(check)
    expect(review).toBeGreaterThan(check)
    expect(step('Check for new package names').block).toContain(
      'node .github/scripts/lockfile-new-packages.mjs'
    )
  })

  it('decides auto-merge from the check output', () => {
    expect(step('Check for new package names').block).toContain(
      'id: new-packages'
    )
    expect(step('Enable auto-merge for Dependabot PRs').block).toContain(
      "if: steps.new-packages.outputs.found == 'false'"
    )
    expect(step('Ask a human to review the new packages').block).toContain(
      "if: steps.new-packages.outputs.found == 'true'"
    )
  })

  it('never interpolates an expression into a run block', () => {
    for (const candidate of steps())
      expect(runBody(candidate.block), candidate.name).not.toContain('${{')
  })
})
