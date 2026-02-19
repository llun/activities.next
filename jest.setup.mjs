/* eslint-disable no-undef */
import fetchMock from 'jest-fetch-mock'
import { TextDecoder, TextEncoder } from 'node:util'

fetchMock.enableMocks()

// changes default behavior of fetchMock to use the real 'fetch' implementation and not mock responses
fetchMock.dontMock()
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

// Polyfill Response.json() for Node test environment
if (typeof Response.json !== 'function') {
  Response.json = function (data, init) {
    const body = JSON.stringify(data)
    const headers = new Headers(init?.headers || {})
    headers.set('content-type', 'application/json')
    return new Response(body, { ...init, headers })
  }
}

// Polyfill Response.redirect() for Node test environment
if (typeof Response.redirect !== 'function') {
  Response.redirect = function (url, status = 302) {
    const headers = new Headers({ location: url.toString() })
    return new Response(null, { status, headers })
  }
}

// Additional safeguard for EventEmitter warnings in test environment
// Set a reasonable higher limit for test execution
if (process.setMaxListeners) {
  process.setMaxListeners(50)
}

jest.mock('got', () => {
  return async (url, options) => {
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
})

jest.mock('./lib/config', () => {
  const host = jest.requireActual('./lib/stub/const').TEST_DOMAIN
  const secretPhase = jest.requireActual('./lib/stub/actor').MOCK_SECRET_PHASES
  return {
    getConfig: jest.fn().mockReturnValue({
      serviceName: 'activities.next',
      host,
      secretPhase,
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

// Mock uuid to avoid ESM issues
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-' + Math.random().toString(36).substring(7))
}))
