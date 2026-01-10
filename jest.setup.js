/* eslint-disable no-undef */
const { TextDecoder, TextEncoder } = require('util')
require('jest-fetch-mock').enableMocks()

// changes default behavior of fetchMock to use the real 'fetch' implementation and not mock responses
fetchMock.dontMock()
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

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
