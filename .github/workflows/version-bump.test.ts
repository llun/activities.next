import { readFileSync } from 'node:fs'

const WORKFLOW_PATH = '.github/workflows/version-bump.yml'

describe('automatic version-bump policy', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8')

  it('caps major-prefixed commits at a minor release', () => {
    expect(workflow).toMatch(/\^major:[\s\S]{0,200}COMMIT_BUMP="minor"/)
    expect(workflow).toMatch(/\^major:[\s\S]{0,200}BODY_BUMP="minor"/)
    expect(workflow).not.toContain('BUMP="major"')
    expect(workflow).not.toContain('MAJOR=$((MAJOR + 1))')
  })
})
