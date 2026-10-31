import dns from 'node:dns'
import http2 from 'node:http2'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { describe, expect, it, vi } from 'vitest'

import {
  takeOutboundViolations,
  waitForOutboundViolation
} from './setup/blockOutboundNetwork'

const PUBLIC_HOST = 'example.com'

// The trap records the violation and throws; consume the record either way, or
// onTestFinished would fail the deliberate-block tests too.
const expectOutboundViolation = async (host: string) => {
  const violations = await waitForOutboundViolation(host)
  expect(violations.length).toBeGreaterThan(0)
  expect(violations[0]).toMatchObject({ host })
}

// Undici's fetch retries through its connector, and the agent may retry too,
// so only the first record's host is asserted.
describe('blockOutboundNetwork trap', () => {
  it('blocks fetch to a public host before any DNS query', async () => {
    const lookup = vi.spyOn(dns, 'lookup')
    await expect(fetch(`https://${PUBLIC_HOST}/`)).rejects.toThrow()
    await expectOutboundViolation(PUBLIC_HOST)
    expect(lookup).not.toHaveBeenCalled()
    lookup.mockRestore()
  })

  it('blocks https.request to a public host', async () => {
    let request: import('node:http').ClientRequest | undefined
    try {
      // The agent creates the connection synchronously, so the trap throws
      // from the constructor.
      request = https.request(`https://${PUBLIC_HOST}/`)
      request.on('error', () => {})
    } catch {
      // Blocked synchronously; the violation is recorded either way.
    }
    await expectOutboundViolation(PUBLIC_HOST)
    request?.destroy()
  })

  it('blocks tls.connect to a public host', async () => {
    try {
      const socket = tls.connect({ host: PUBLIC_HOST, port: 443 })
      socket.on('error', () => {})
      socket.destroy()
    } catch {
      // The trap may throw synchronously from tls.connect; either way the
      // violation is recorded.
    }
    await expectOutboundViolation(PUBLIC_HOST)
  })

  it('blocks http2.connect to a public host', async () => {
    let session: http2.ClientHttp2Session | undefined
    try {
      session = http2.connect(`https://${PUBLIC_HOST}`)
      session.on('error', () => {})
    } catch {
      // The trap may throw synchronously from http2.connect.
    }
    await expectOutboundViolation(PUBLIC_HOST)
    session?.close()
  })

  it('blocks net.connect to a public host', async () => {
    try {
      const socket = net.connect({ host: PUBLIC_HOST, port: 80 })
      socket.on('error', () => {})
      socket.destroy()
    } catch {
      // The trap throws synchronously from net.connect.
    }
    await expectOutboundViolation(PUBLIC_HOST)
  })

  it.each(['127.0.0.1', 'localhost', '::1'])(
    'allows a loopback connection to %s',
    async (host) => {
      await new Promise<void>((resolve) => {
        const socket = net.connect({ host, port: 1 })
        socket.once('error', () => resolve())
        socket.once('connect', () => {
          socket.destroy()
          resolve()
        })
      })
      expect(takeOutboundViolations()).toEqual([])
    }
  )

  it('allows connect() without a host (localhost default)', async () => {
    await new Promise<void>((resolve) => {
      const socket = net.connect(1)
      socket.once('error', () => resolve())
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
    })
    expect(takeOutboundViolations()).toEqual([])
  })

  it('allows a unix socket path', async () => {
    await new Promise<void>((resolve) => {
      const socket = net.connect('/tmp/activities-next-guard-trap-test.sock')
      socket.once('error', () => resolve())
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
    })
    expect(takeOutboundViolations()).toEqual([])
  })

  // The guard's error fails the test even though the test body swallowed the
  // blocked fetch, so it.fails is the honest shape (same as the timer guard).
  it.fails(
    'still fails the test when the blocked error is swallowed',
    async () => {
      await fetch(`https://${PUBLIC_HOST}/`).catch(() => undefined)
    }
  )
})
