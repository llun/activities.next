import * as matchers from 'jest-extended'
import fetchMock from 'jest-fetch-mock'
import { TextDecoder, TextEncoder } from 'node:util'
import { afterEach, beforeEach, expect, vi } from 'vitest'

import { resetTrustProxyIpHeadersConfigCacheForTests } from '@/lib/config/trustProxyIpHeaders'
// Direct sub-path import required: the barrel loads cors.ts which imports
// @/lib/config, interfering with per-test module mock isolation.
import { resetContentSecurityPolicyCacheForTests } from '@/lib/utils/http-headers/csp'

expect.extend(matchers)

fetchMock.enableMocks()
// Default to the real `fetch` implementation; tests opt into mocking.
fetchMock.dontMock()

global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder as typeof global.TextDecoder

// Polyfill Response.json() for the Node test environment.
if (typeof Response.json !== 'function') {
  Response.json = function (data, init) {
    const body = JSON.stringify(data)
    const headers = new Headers(init?.headers || {})
    headers.set('content-type', 'application/json')
    return new Response(body, { ...init, headers })
  }
}

// Polyfill Response.redirect() for the Node test environment.
if (typeof Response.redirect !== 'function') {
  Response.redirect = function (url, status = 302) {
    const headers = new Headers({ location: url.toString() })
    return new Response(null, { status, headers })
  }
}

if (process.setMaxListeners) {
  process.setMaxListeners(50)
}

// jsdom dispatches focus/blur/focusin/focusout synchronously from
// HTMLElement.focus(). Radix UI's FocusScope (DropdownMenu, Dialog, …) reacts to
// a focusout that lands outside its container by calling .focus() again to pull
// focus back — which in jsdom synchronously fires another focusout that
// re-enters the same handler. When a menu closes while a dialog opens (e.g. the
// ⋯ post menu's Delete / Report / Mute / Block confirmations), two focus scopes
// hand focus back and forth and the re-entry never settles, overflowing the
// stack with "RangeError: Maximum call stack size exceeded". A real browser
// dispatches these events asynchronously and has internal focus-fixup guards, so
// this is purely a jsdom artifact — but it crashed the Vitest worker and, as the
// thrown errors piled up, surfaced intermittently as a CI test "heap OOM".
// Bound the synchronous re-entry depth so the loop unwinds instead of
// overflowing; genuine focus flows never nest .focus() anywhere near this deep,
// so top-level focus() and document.activeElement stay unaffected.
if (typeof HTMLElement !== 'undefined') {
  const MAX_SYNCHRONOUS_FOCUS_DEPTH = 10
  const nativeFocus = HTMLElement.prototype.focus
  let focusDepth = 0
  HTMLElement.prototype.focus = function focus(
    this: HTMLElement,
    ...args: Parameters<HTMLElement['focus']>
  ) {
    if (focusDepth >= MAX_SYNCHRONOUS_FOCUS_DEPTH) return
    focusDepth += 1
    try {
      nativeFocus.apply(this, args)
    } finally {
      focusDepth -= 1
    }
  }
}

// Jest exposed a global `fail()`; Vitest does not. Provide a compatible shim.
globalThis.fail = (message?: string): never => {
  throw new Error(message ?? 'fail() was called')
}

beforeEach(() => {
  resetTrustProxyIpHeadersConfigCacheForTests()
  resetContentSecurityPolicyCacheForTests()
})

afterEach(() => {
  resetTrustProxyIpHeadersConfigCacheForTests()
  resetContentSecurityPolicyCacheForTests()
})

vi.mock('got', async () => {
  const { Readable } = await import('node:stream')

  const readResponse = async (url, options) => {
    const response = await fetch(url, {
      method: options.method,
      body: options.body,
      headers: {
        ...options.headers
      }
    })
    if (response.status < 300) {
      const body = await response.text()
      return { statusCode: response.status, body }
    }

    return { statusCode: response.status }
  }

  const gotMock = async (url, options) => readResponse(url, options)

  gotMock.stream = (url, options) => {
    const stream = new Readable({
      read() {}
    })

    void (async () => {
      try {
        const response = await fetch(url, {
          method: options.method,
          body: options.body,
          headers: {
            ...options.headers
          }
        })
        const headers = {}
        response.headers.forEach((value, key) => {
          headers[key] = value
        })

        stream.emit('response', {
          headers,
          statusCode: response.status
        })
        if (stream.destroyed) return

        const body = await response.text()
        if (stream.destroyed) return

        stream.push(Buffer.from(body))
        stream.push(null)
      } catch (error) {
        stream.destroy(
          error instanceof Error ? error : new Error(String(error))
        )
      }
    })()

    return stream
  }

  return { default: gotMock }
})

vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async (_hostname, options) => {
    const address = { address: '93.184.216.34', family: 4 }
    return options?.all ? [address] : address
  })
  return { default: { lookup }, lookup }
})

vi.mock('@/lib/config', async () => {
  const { TEST_DOMAIN } =
    await vi.importActual<typeof import('@/lib/stub/const')>('@/lib/stub/const')
  const { MOCK_SECRET_PHASES } =
    await vi.importActual<typeof import('@/lib/stub/actor')>('@/lib/stub/actor')
  return {
    getBaseURL: vi.fn().mockReturnValue(`https://${TEST_DOMAIN}`),
    getAuthScheme: vi.fn().mockReturnValue('https'),
    buildBaseURL: vi.fn((host: string) =>
      host.includes('://') ? host : `https://${host}`
    ),
    getConfig: vi.fn().mockReturnValue({
      serviceName: 'activities.next',
      host: TEST_DOMAIN,
      secretPhase: MOCK_SECRET_PHASES,
      email: {
        serviceFromAddress: 'test@llun.dev'
      },
      database: {
        type: 'knex',
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      }
    })
  }
})

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substring(7))
}))
