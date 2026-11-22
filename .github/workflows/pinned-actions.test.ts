import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const GITHUB_DIR = join(import.meta.dirname, '..')

// Every workflow and composite action under .github.
function yamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return yamlFiles(path)
    return /\.ya?ml$/.test(entry.name) ? [path] : []
  })
}

describe('third-party actions', () => {
  // Actions use their version tag (`@v7`), not a commit SHA: the tag may move
  // to a newer release, which is accepted. Local `./` actions live in this
  // repository.
  it('use a version tag, not a commit SHA', () => {
    const untagged: string[] = []
    for (const file of yamlFiles(GITHUB_DIR)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const match = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/)
        if (!match || match[1].startsWith('./')) continue
        if (!/@v\d+(\.\d+)*$/.test(match[1])) {
          untagged.push(`${file.slice(GITHUB_DIR.length + 1)}: ${line.trim()}`)
        }
      }
    }
    expect(untagged).toEqual([])
  })
})
