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

  it('blocks fs reads outside node_modules', () => {
    expect(() => fs.readFileSync('./package.json', 'utf8')).toThrow(
      /blocked in small tests/
    )
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-read')
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

  it('blocks fs.open reads outside node_modules and allows them inside', () => {
    expect(() => fs.openSync('./package.json', 'r')).toThrow(
      /blocked in small tests/
    )
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-read')
    const handle = fs.openSync(
      path.join(process.cwd(), 'node_modules/vitest/package.json'),
      'r'
    )
    fs.closeSync(handle)
    expect(takeSmallGuardViolations()).toEqual([])
  })

  it('blocks fs.promises.open with a write flag', async () => {
    await expect(open('/tmp/guard-small-probe.txt', 'w')).rejects.toThrow(
      /blocked in small tests/
    )
    expect(takeSmallGuardViolations().map((v) => v.kind)).toContain('fs-write')
  })

  it('blocks a copyFile whose destination is outside node_modules', () => {
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
