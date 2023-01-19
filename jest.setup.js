/* eslint-disable @typescript-eslint/no-var-requires,no-undef */
const { TextDecoder, TextEncoder } = require('util')
require('jest-fetch-mock').enableMocks()

// changes default behavior of fetchMock to use the real 'fetch' implementation and not mock responses
fetchMock.dontMock()
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

jest.mock('@digitalbazaar/http-client', () => {
  return {
    httpClient: jest.fn()
  }
})
