import { readFileSync, readdirSync } from 'node:fs'

const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
const lines = ci.split('\n')

describe('ci.yml guard rails', () => {
  it('runs once per commit: push to main, pull requests and workflow_dispatch', () => {
    expect(ci).toContain(
      'on:\n  push:\n    branches: [main]\n  pull_request:\n  workflow_dispatch:\n'
    )
  })

  it('bounds every job with a timeout-minutes', () => {
    const jobs = lines.filter(
      (line, index) =>
        /^ {2}[a-z-]+:$/.test(line) && /^ {4}name: /.test(lines[index + 1])
    )
    const timeouts = lines.filter((line) =>
      /^ {4}timeout-minutes: \d+$/.test(line)
    )

    expect(jobs.length).toBe(9)
    expect(timeouts.length).toBe(jobs.length)
  })

  it('pins the runner image (no ubuntu-latest in the file)', () => {
    expect(ci).not.toContain('ubuntu-latest')
  })

  it('keeps the aggregate jobs failing closed', () => {
    expect(ci).toContain('name: All Tests')
    expect(ci).toContain('name: Lint and Prettier')
    expect(ci).toContain('name: Build')
    expect(ci.match(/if \[ "\$result" != "success" \]/g)?.length).toBe(2)
  })

  it('installs through the shared retry action, never a bare yarn install', () => {
    const installSteps = lines.filter((line, index) => {
      if (line.trim() !== '- name: Install dependencies') return false
      expect(lines[index + 1]).toContain('uses: ./.github/actions/install')
      return true
    })

    expect(installSteps.length).toBeGreaterThan(0)
    expect(ci).not.toContain('run: yarn install --immutable')
  })

  it('keeps the least-privilege token', () => {
    expect(ci).toContain('permissions:\n  contents: read')
    expect(ci).not.toContain('actions: write')
  })

  it('gives every workspace a no-op Dependabot entry', () => {
    const dependabot = readFileSync('.github/dependabot.yml', 'utf8')
    const entries = dependabot.split('\n  - package-ecosystem:')

    for (const name of readdirSync('packages')) {
      const entry = entries.find((chunk) =>
        chunk.includes(`directory: '/packages/${name}'`)
      )
      expect(
        entry,
        `dependabot.yml has no entry for /packages/${name}`
      ).toBeTruthy()
      expect(
        entry,
        `the /packages/${name} entry does not ignore all dependencies`
      ).toContain("dependency-name: '*'")
    }
  })
})
