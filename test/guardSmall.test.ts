// @vitest-size small
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { open, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import {
  setInterval as timersSetInterval,
  setTimeout as timersSetTimeout
} from 'node:timers'
import {
  setInterval as promisesSetInterval,
  setTimeout as promisesSetTimeout
} from 'node:timers/promises'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'

import { createDatabaseConnection } from '@/lib/database/connection'

import { takeOutboundViolations } from './setup/blockOutboundNetwork'
import { takeSmallGuardViolations } from './setup/guardSmall'
import { isVitestInternalsWrite } from './setup/guardViolations'

// Exercises the small-project guards (test/setup/guardSmall.ts) the same way
// test/blockOutboundNetwork.test.ts exercises the network trap: trigger the
// forbidden call, catch the synchronous throw, and consume the recorded
// violation so onTestFinished has nothing left to fail the test for. This file
// must stay small (`@vitest-size small` above) so it runs inside the guard it
// tests.

describe('small test guard', () => {
  it.each([
    [
      'writeFileSync',
      () => fs.writeFileSync('/tmp/guard-small-probe.txt', 'x')
    ],
    ['mkdirSync', () => fs.mkdirSync('/tmp/guard-small-probe-dir')],
    ['unlinkSync', () => fs.unlinkSync('/tmp/guard-small-probe.txt')],
    [
      'createWriteStream',
      () => fs.createWriteStream('/tmp/guard-small-probe.txt')
    ]
  ])('blocks the fs write %s', (_name, call) => {
    expect(call).toThrow(/blocked in small tests/)
    expect(
      takeSmallGuardViolations().map((violation) => violation.kind)
    ).toContain('fs-write')
  })

  it('blocks named ESM imports from node:fs/promises', async () => {
    await expect(writeFile('/tmp/guard-small-probe.txt', 'x')).rejects.toThrow(
      /blocked in small tests/
    )
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-write')
  })

  it('blocks a coverage-report path written by the test itself (the stack decides, not the path)', () => {
    const report = path.join(
      process.cwd(),
      '.review/cov/.tmp/coverage-997946cc-e1da-4fcc-a015-c9ff3f418f5f.json'
    )
    expect(() => fs.writeFileSync(report, '{}')).toThrow(
      /blocked in small tests/
    )
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-write')
  })

  it('allows a write whose stack originates in @vitest (the coverage provider)', () => {
    const guardFrame = `at captureStack (${path.join(process.cwd(), 'test/setup/guardViolations.ts')}:30:12)`
    expect(
      isVitestInternalsWrite(
        `Error\n    ${guardFrame}\n    at writeCoverageFile (file://${process.cwd()}/node_modules/@vitest/coverage-v8/dist/commands-C6w5FFZp.js:170:9)\n    at Object.takeCoverage (file://${process.cwd()}/node_modules/@vitest/coverage-v8/dist/index.js:72:16)`
      )
    ).toBe(true)
    expect(
      isVitestInternalsWrite(
        `Error\n    ${guardFrame}\n    at ${path.join(process.cwd(), 'test/guardSmall.test.ts')}:10:8\n    at runTest (file://${process.cwd()}/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:3892:4)`
      )
    ).toBe(false)
  })

  it('blocks fs reads inside the repository', () => {
    expect(() => fs.readFileSync('./package.json', 'utf8')).toThrow(
      /blocked in small tests/
    )
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-read')
  })

  it('blocks fs reads through a percent-encoded file: URL inside the repository', () => {
    const encoded = process.cwd().replaceAll('%', '%25').replaceAll('-', '%2D')
    expect(() =>
      fs.readFileSync(new URL(`file://${encoded}/package.json`), 'utf8')
    ).toThrow(/blocked in small tests/)
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-read')
  })

  it('allows fs reads outside the repository (system files are not fixtures)', () => {
    expect(() => fs.readFileSync('/etc/hosts', 'utf8')).not.toThrow()
    expect(takeSmallGuardViolations()).toEqual([])
  })

  it('allows fs reads from node_modules (Vitest internals keep working)', () => {
    const pkg = path.join(process.cwd(), 'node_modules/vitest/package.json')
    expect(() => fs.readFileSync(pkg, 'utf8')).not.toThrow()
    expect(takeSmallGuardViolations()).toEqual([])
  })

  it('blocks fs.open with a write flag', () => {
    expect(() => fs.openSync('/tmp/guard-small-probe.txt', 'w')).toThrow(
      /blocked in small tests/
    )
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-write')
  })

  it('blocks fs.open reads inside the repository and allows them outside', () => {
    expect(() => fs.openSync('./package.json', 'r')).toThrow(
      /blocked in small tests/
    )
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-read')
    const outside = fs.openSync('/etc/hosts', 'r')
    fs.closeSync(outside)
    const packaged = fs.openSync(
      path.join(process.cwd(), 'node_modules/vitest/package.json'),
      'r'
    )
    fs.closeSync(packaged)
    expect(takeSmallGuardViolations()).toEqual([])
  })

  it('treats a numeric read flag and a callback-only fs.open as reads', () => {
    expect(() => fs.openSync('./package.json', fs.constants.O_RDONLY)).toThrow(
      /blocked in small tests/
    )
    expect(() => fs.open('./package.json', () => undefined)).toThrow(
      /blocked in small tests/
    )
    expect(takeSmallGuardViolations().map((v) => v.kind)).toEqual([
      'fs-read',
      'fs-read'
    ])
  })

  it('blocks fs.promises.open with a write flag', async () => {
    await expect(open('/tmp/guard-small-probe.txt', 'w')).rejects.toThrow(
      /blocked in small tests/
    )
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-write')
  })

  it('blocks a copyFile whose destination is outside the repository', () => {
    expect(() =>
      fs.copyFileSync(
        path.join(process.cwd(), 'node_modules/vitest/package.json'),
        '/tmp/guard-small-probe.txt'
      )
    ).toThrow(/blocked in small tests/)
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-write')
  })

  it('blocks named ESM imports from node:child_process', () => {
    expect(() => execSync('true')).toThrow(/blocked in small tests/)
    expect(
      takeSmallGuardViolations().map((violation) => violation.kind)
    ).toContain('child-process')
  })

  it('blocks loopback sockets', () => {
    expect(() => net.connect({ host: '127.0.0.1', port: 1 })).toThrow(
      /blocked in tests/
    )
    expect(takeOutboundViolations().length).toBeGreaterThan(0)
  })

  it('blocks unix sockets', () => {
    expect(() => net.connect('/tmp/guard-small-test.sock')).toThrow(
      /blocked in tests/
    )
    expect(takeOutboundViolations().length).toBeGreaterThan(0)
  })

  it('throws when a real timer of 100ms or more is armed', () => {
    expect(() => {
      setTimeout(() => {}, 150)
    }).toThrow(/blocked in small tests/)
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain(
      'long-timer'
    )
  })

  it('throws when a real setInterval of 100ms or more is armed', () => {
    expect(() => {
      setInterval(() => {}, 150)
    }).toThrow(/blocked in small tests/)
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain(
      'long-timer'
    )
  })

  it('throws for a long wait through node:timers named imports', () => {
    expect(() => {
      timersSetTimeout(() => {}, 150)
    }).toThrow(/blocked in small tests/)
    expect(() => {
      timersSetInterval(() => {}, 150)
    }).toThrow(/blocked in small tests/)
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain(
      'long-timer'
    )
  })

  it('throws for a long wait through node:timers/promises named imports', () => {
    expect(() => {
      promisesSetTimeout(150)
    }).toThrow(/blocked in small tests/)
    expect(() => {
      promisesSetInterval(150)
    }).toThrow(/blocked in small tests/)
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain(
      'long-timer'
    )
  })

  it('throws for a long wait through promisify(setTimeout)', () => {
    expect(() => {
      promisify(setTimeout)(150)
    }).toThrow(/blocked in small tests/)
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain(
      'long-timer'
    )
  })

  it('still allows short real waits through every wrapped route', async () => {
    await expect(promisify(setTimeout)(1)).resolves.toBeUndefined()
    await expect(promisesSetTimeout(1)).resolves.toBeUndefined()
    expect(takeSmallGuardViolations()).toEqual([])
  })

  it('leaves fake timers alone', () => {
    vi.useFakeTimers()
    try {
      expect(() => {
        setTimeout(() => {}, 150)
      }).not.toThrow()
      expect(() => {
        setInterval(() => {}, 150)
      }).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
    expect(takeSmallGuardViolations()).toEqual([])
  })

  it('lets node:timers named imports follow fake timers', () => {
    vi.useFakeTimers()
    try {
      expect(() => {
        timersSetTimeout(() => {}, 150)
      }).not.toThrow()
      expect(() => {
        timersSetInterval(() => {}, 150)
      }).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
    expect(takeSmallGuardViolations()).toEqual([])
  })

  it('hands a named-import interval to fake timers faking only setInterval', () => {
    vi.useFakeTimers({ toFake: ['setInterval'] })
    try {
      expect(() => {
        timersSetInterval(() => {}, 150)
      }).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
    expect(takeSmallGuardViolations()).toEqual([])
  })

  it('blocks createDatabaseConnection from the shared module', () => {
    expect(() =>
      createDatabaseConnection({ client: 'better-sqlite3' } as never)
    ).toThrow(/blocked in small tests/)
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain(
      'db-connection'
    )
  })

  // The guard's error fails the test even though the test body swallowed the
  // rejected write, so it.fails is the honest shape (same as the network trap).
  it.fails(
    'still fails the test when the blocked fs write is swallowed',
    async () => {
      await writeFile('/tmp/guard-small-probe.txt', 'x').catch(() => undefined)
    }
  )
})
