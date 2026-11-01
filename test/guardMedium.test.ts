// @vitest-size medium
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { takeOutboundViolations } from './setup/blockOutboundNetwork'
import { takeMediumGuardViolations } from './setup/guardMedium'

// Exercises the medium-project guards (test/setup/guardMedium.ts) the same way
// test/blockOutboundNetwork.test.ts exercises the network trap: trigger the
// forbidden call, catch the throw, and consume the recorded violation so
// onTestFinished has nothing left to fail the test for. The `@vitest-size
// medium` docblock keeps this file inside the guard it tests.

const tmpFile = (name: string) => path.join(fs.realpathSync(os.tmpdir()), name)

describe('medium test guard', () => {
  const probe = tmpFile('guard-medium-probe.txt')
  // Cleanup only: draining violations here would swallow them before the
  // guard's onTestFinished hook runs (it fires after every afterEach), and
  // the it.fails test below must be failed by that hook, not by an assertion
  // here.
  afterEach(() => {
    fs.rmSync(probe, { force: true })
  })

  it('allows fs writes inside os.tmpdir()', async () => {
    await writeFile(probe, 'written')
    expect(fs.readFileSync(probe, 'utf8')).toBe('written')
  })

  it.each([
    [
      'writeFileSync',
      () =>
        fs.writeFileSync(
          path.join(process.cwd(), 'guard-medium-probe.txt'),
          'x'
        )
    ],
    [
      'mkdirSync',
      () => fs.mkdirSync(path.join(process.cwd(), 'guard-medium-probe-dir'))
    ],
    [
      'createWriteStream',
      () =>
        fs.createWriteStream(path.join(process.cwd(), 'guard-medium-probe.txt'))
    ]
  ])('blocks fs writes outside os.tmpdir(): %s', (_name, call) => {
    expect(call).toThrow(/blocked in medium tests/)
    expect(
      takeMediumGuardViolations().map((violation) => violation.kind)
    ).toContain('fs-write')
  })

  it('blocks named ESM imports from node:fs/promises outside os.tmpdir()', async () => {
    await expect(
      writeFile(path.join(process.cwd(), 'guard-medium-probe.txt'), 'x')
    ).rejects.toThrow(/blocked in medium tests/)
    expect(
      takeMediumGuardViolations().map((violation) => violation.kind)
    ).toContain('fs-write')
  })

  it('allows mkdtemp (it creates under os.tmpdir())', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-medium-'))
    expect(fs.existsSync(dir)).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('blocks fs.open with a write flag outside os.tmpdir()', () => {
    expect(() =>
      fs.openSync(path.join(process.cwd(), 'guard-medium-probe.txt'), 'w')
    ).toThrow(/blocked in medium tests/)
    expect(
      takeMediumGuardViolations().map((violation) => violation.kind)
    ).toContain('fs-write')
  })

  it('allows fs.open reads outside os.tmpdir() and writes inside it', () => {
    const readHandle = fs.openSync(
      path.join(process.cwd(), 'package.json'),
      'r'
    )
    fs.closeSync(readHandle)
    const writeHandle = fs.openSync(probe, 'w')
    fs.closeSync(writeHandle)
    expect(takeMediumGuardViolations()).toEqual([])
  })

  it('blocks a rename whose destination is outside os.tmpdir()', () => {
    expect(() =>
      fs.renameSync(probe, path.join(process.cwd(), 'guard-medium-probe.txt'))
    ).toThrow(/blocked in medium tests/)
    expect(
      takeMediumGuardViolations().map((violation) => violation.kind)
    ).toContain('fs-write')
  })

  it('blocks child_process functions', () => {
    expect(() => execSync('true')).toThrow(/blocked in medium tests/)
    expect(
      takeMediumGuardViolations().map((violation) => violation.kind)
    ).toContain('child-process')
  })

  it('still allows loopback sockets (the test database needs them)', async () => {
    await new Promise<void>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port: 1 })
      socket.once('error', () => resolve())
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
    })
    expect(takeOutboundViolations()).toEqual([])
    expect(takeMediumGuardViolations()).toEqual([])
  })

  // The guard's error fails the test even though the test body swallowed the
  // rejected write, so it.fails is the honest shape (same as the network trap).
  it.fails(
    'still fails the test when the blocked fs write is swallowed',
    async () => {
      await writeFile(
        path.join(process.cwd(), 'guard-medium-probe.txt'),
        'x'
      ).catch(() => undefined)
    }
  )
})
