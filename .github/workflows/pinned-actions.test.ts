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
  // A tag can be repointed at different code (tj-actions, Trivy, actions-cool);
  // a full commit SHA cannot. Local `./` actions live in this repository.
  it('are pinned to a full commit SHA with a version comment', () => {
    const unpinned: string[] = []
    for (const file of yamlFiles(GITHUB_DIR)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const match = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/)
        if (!match || match[1].startsWith('./')) continue
        if (!/@[0-9a-f]{40}$/.test(match[1]) || !/^\s+#\s+v\d/.test(match[2])) {
          unpinned.push(`${file.slice(GITHUB_DIR.length + 1)}: ${line.trim()}`)
        }
      }
    }
    expect(unpinned).toEqual([])
  })
})
