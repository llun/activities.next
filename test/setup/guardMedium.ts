import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createViolationRecorder, guardBuiltins } from './guardViolations'

// Medium tests may touch local resources — a test database, the filesystem
// inside the OS temp directory, real short waits — but never spawn a process
// and never write outside the temp directory. The outbound-network trap keeps
// its base policy (loopback allowed, which the test database needs).

const violations = createViolationRecorder()

// Guard-test seam: test/guardMedium.test.ts triggers violations on purpose.
export const takeMediumGuardViolations = () => violations.take()

// os.tmpdir() can itself be a symlinked path (macOS: /tmp -> /private/tmp),
// so both the raw and the real path are accepted prefixes; a path that only
// matches through a symlink is judged after realpathSync, which needs the
// file to exist already.
const TMP_ROOTS = [path.resolve(os.tmpdir()), realpathSync(os.tmpdir())]

const isInsideTmp = (resolved: string): boolean => {
  const under = (p: string): boolean =>
    TMP_ROOTS.some((root) => p === root || p.startsWith(root + path.sep))
  if (under(resolved)) return true
  try {
    return under(realpathSync(resolved))
  } catch {
    return false
  }
}

guardBuiltins(violations, 'medium', isInsideTmp)

violations.installFailHooks('medium-test')
