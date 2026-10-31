import crypto from 'crypto'
import * as matchers from 'jest-extended'
import fetchMock from 'jest-fetch-mock'
import { TextDecoder, TextEncoder } from 'node:util'
import { afterEach, beforeEach, expect, onTestFinished, vi } from 'vitest'

import { resetTrustProxyIpHeadersConfigCacheForTests } from '@/lib/config/trustProxyIpHeaders'
import {
  MOCK_PRIVATE_KEY,
  MOCK_PUBLIC_KEY,
  MOCK_SECRET_PHASES
} from '@/lib/stub/actor'
// Direct sub-path import required: the barrel loads cors.ts which imports
// @/lib/config, interfering with per-test module mock isolation.
import { resetContentSecurityPolicyCacheForTests } from '@/lib/utils/http-headers/csp'

expect.extend(matchers)

// Suite-wide: a 4096-bit RSA keygen runs on the libuv threadpool that every
// worker thread shares, and under load it reached the 30 s test limit
// (fediverseInterop.test.ts). Return the stub key pair instead. The stub
// private key is stored encrypted with MOCK_SECRET_PHASES, but callers pass
// their own secretPhase (generateKeyPair(getConfig().secretPhase)) and
// signedHeaders later decrypts with getConfig().secretPhase — a test mocking
// @/lib/config with a different secretPhase would otherwise fail every signed
// request with "bad decrypt". Re-encrypt the stub key with the requested
// secretPhase so the pair works under any config.
vi.mock('@/lib/utils/signature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/signature')>()
  const reencryptStubPrivateKey = (secretPhase: string): string =>
    crypto
      .createPrivateKey({
        key: MOCK_PRIVATE_KEY,
        passphrase: MOCK_SECRET_PHASES
      })
      .export({
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: secretPhase
      }) as string
  return {
    ...actual,
    generateKeyPair: async (secretPhase: string) => ({
      publicKey: MOCK_PUBLIC_KEY,
      privateKey:
        secretPhase === MOCK_SECRET_PHASES
          ? MOCK_PRIVATE_KEY
          : reencryptStubPrivateKey(secretPhase)
    })
  }
})

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
// so top-level focus() and document.activeElement stay unaffected. jsdom gives
// HTMLElement and SVGElement their own separate focus(), so guard both.
const MAX_SYNCHRONOUS_FOCUS_DEPTH = 10
let focusDepth = 0
const installFocusDepthGuard = (
  proto: { focus: (...args: never[]) => void } | undefined
) => {
  if (!proto?.focus) return
  const nativeFocus = proto.focus
  proto.focus = function focus(this: unknown, ...args: never[]) {
    if (focusDepth >= MAX_SYNCHRONOUS_FOCUS_DEPTH) return
    focusDepth += 1
    try {
      nativeFocus.apply(this, args)
    } finally {
      focusDepth -= 1
    }
  }
}
if (typeof HTMLElement !== 'undefined') {
  installFocusDepthGuard(HTMLElement.prototype)
}
if (typeof SVGElement !== 'undefined') {
  installFocusDepthGuard(SVGElement.prototype)
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

// A timer that is still armed when a jsdom test ends outlives its component
// (React cleanups clear theirs on unmount, which runs in an afterEach hook
// before the check below). It fires after the file's jsdom is torn down and
// throws `window/document is not defined` as an unhandled error that fails
// the shard without naming the test. Fail the test instead, with the stack
// that armed the timer. Timers under LONG_TIMER_MS are left alone: Radix,
// next/link and React itself arm 0–1ms timers that settle on their own.
const LONG_TIMER_MS = 100
if (typeof window !== 'undefined') {
  type Armed = { delay: number; stack: string }
  const armed = new Map<ReturnType<typeof setTimeout>, Armed>()
  const nativeSetTimeout = globalThis.setTimeout
  const nativeClearTimeout = globalThis.clearTimeout
  let guarding = false
  const guardedSetTimeout = ((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) => {
    const id = nativeSetTimeout(
      (...callbackArgs: unknown[]) => {
        armed.delete(id)
        if (typeof handler === 'function') handler(...callbackArgs)
      },
      delay,
      ...args
    )
    if (guarding && (delay ?? 0) >= LONG_TIMER_MS) {
      const stack = new Error().stack ?? ''
      // next/dynamic's own loading delay: the framework clears it when the
      // import settles, and no app code can clear it first.
      if (!stack.includes('loadable.shared-runtime')) {
        armed.set(id, { delay: delay ?? 0, stack })
      }
    }
    return id
  }) as typeof setTimeout
  guardedSetTimeout.__promisify__ = nativeSetTimeout.__promisify__
  globalThis.setTimeout = guardedSetTimeout
  globalThis.clearTimeout = ((id) => {
    armed.delete(id as ReturnType<typeof setTimeout>)
    return nativeClearTimeout(id)
  }) as typeof clearTimeout

  beforeEach(() => {
    armed.clear()
    guarding = true
    // The check must run after every afterEach hook, so it lives in
    // onTestFinished, not an afterEach: this file's hooks are registered
    // before a test file imports @testing-library/react, which registers
    // afterEach(cleanup) at import, so under `sequence.hooks: 'list'` an
    // afterEach here would run before the tree unmounts and flag every
    // timer a component clears on unmount.
    onTestFinished(() => {
      guarding = false
      if (armed.size === 0) return
      const leaked = [...armed.values()]
      for (const id of armed.keys()) nativeClearTimeout(id)
      armed.clear()
      throw new Error(
        `${leaked.length} timer(s) of ≥${LONG_TIMER_MS}ms still armed when the test ended; clear them on unmount or await them:\n` +
          leaked
            .map((timer) => `- ${timer.delay}ms armed at ${timer.stack}`)
            .join('\n')
      )
    })
  })
}

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
  const { getAltTextConfig } = await vi.importActual<
    typeof import('@/lib/config/altText')
  >('@/lib/config/altText')
  const photoEditor = await vi.importActual<
    typeof import('@/lib/config/photoEditor')
  >('@/lib/config/photoEditor')
  const webVitals = await vi.importActual<
    typeof import('@/lib/config/webVitals')
  >('@/lib/config/webVitals')
  return {
    getBaseURL: vi.fn().mockReturnValue(`https://${TEST_DOMAIN}`),
    // Reads the environment like the real one, without the warning.
    getWebVitalsConfig: vi.fn(() => webVitals.getWebVitalsConfig()),
    // Reads the environment like the real one, without the warning.
    getPhotoEditorConfig: vi.fn(() =>
      photoEditor.getPhotoEditorConfig({
        altText: getAltTextConfig({ quiet: true })?.altText
      })
    ),
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
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      }
    })
  }
})
