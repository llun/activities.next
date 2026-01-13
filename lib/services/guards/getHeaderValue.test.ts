import { IncomingHttpHeaders } from 'http'

import { getHeadersValue } from './getHeaderValue'

describe('#getHeadersValue', () => {
  describe('with standard Headers', () => {
    it('returns value for existing header', () => {
      const headers = new Headers([
        ['Content-Type', 'application/json'],
        ['Authorization', 'Bearer token']
      ])
      expect(getHeadersValue(headers, 'Content-Type')).toEqual(
        'application/json'
      )
      expect(getHeadersValue(headers, 'Authorization')).toEqual('Bearer token')
    })

    it('returns null for non-existing header', () => {
      const headers = new Headers()
      expect(getHeadersValue(headers, 'X-Custom-Header')).toBeNull()
    })

    it('is case-insensitive', () => {
      const headers = new Headers([['Content-Type', 'application/json']])
      expect(getHeadersValue(headers, 'content-type')).toEqual(
        'application/json'
      )
    })
  })

  describe('with IncomingHttpHeaders', () => {
    it('returns value for existing header', () => {
      const headers: IncomingHttpHeaders = {
        'content-type': 'application/json',
        authorization: 'Bearer token'
      }
      expect(getHeadersValue(headers, 'content-type')).toEqual(
        'application/json'
      )
      expect(getHeadersValue(headers, 'authorization')).toEqual('Bearer token')
    })

    it('returns undefined for non-existing header', () => {
      const headers: IncomingHttpHeaders = {}
      expect(getHeadersValue(headers, 'x-custom-header')).toBeUndefined()
    })

    it('handles array values', () => {
      const headers: IncomingHttpHeaders = {
        'set-cookie': ['cookie1=value1', 'cookie2=value2']
      }
      expect(getHeadersValue(headers, 'set-cookie')).toEqual([
        'cookie1=value1',
        'cookie2=value2'
      ])
    })
  })
})
