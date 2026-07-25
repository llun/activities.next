import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// Only source-shaped files. Real binaries (images, fonts) legitimately contain
// NUL and are excluded by extension rather than by directory, so a new asset
// anywhere does not silently widen the check.
const BINARY_EXTENSIONS = [
  '.png',
  '.ico',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp4',
  '.webm',
  '.zip',
  '.gz',
  '.fit'
]

/**
 * A NUL byte in a source file is legal in a JavaScript string literal and
 * changes nothing at runtime, so nothing else in the gate notices — prettier
 * and eslint both pass. But git's binary heuristic keys off NUL, so the file
 * stops diffing: `git diff` prints "Binary files … differ", GitHub renders
 * "Binary file not shown", `grep` skips it, and `git blame` and three-way
 * merge stop working on it.
 *
 * That is a review-integrity failure rather than a runtime one, which is
 * exactly why it needs a guard: reply-by-email shipped its job file — token
 * resolution, authorization re-checks, attacker-supplied base64 decoding — as
 * an undiffable blob, and only a byte-level inspection caught it.
 */
describe('source files', () => {
  it('contain no NUL bytes, which would make git treat them as binary', () => {
    // Newline-separated rather than `git ls-files -z`: the -z separator is
    // itself a NUL, and writing one into this file is the very thing the
    // test forbids. Paths containing a newline would be missed, and none
    // exist here.
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
      .split('\n')
      .filter(Boolean)
      .filter(
        (file) =>
          !BINARY_EXTENSIONS.some((extension) => file.endsWith(extension))
      )

    expect(tracked.length).toBeGreaterThan(100)

    const offenders = tracked.filter((file) => {
      const path = join(repoRoot, file)
      // A tracked path can be absent in a partial checkout, or be a submodule.
      try {
        if (!statSync(path).isFile()) return false
      } catch {
        return false
      }
      return readFileSync(path).includes(0)
    })

    expect(offenders).toEqual([])
  })
})
