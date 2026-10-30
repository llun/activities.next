import { describe, expect, it } from 'vitest'

import { VERSION, withVersion } from './version'

describe('version utils', () => {
  describe('withVersion', () => {
    it('appends version query parameter', () => {
      expect(withVersion('/favicon.ico')).toBe(
        `/favicon.ico?v=${encodeURIComponent(VERSION)}`
      )
    })

    it('appends version to path that already has query parameters', () => {
      expect(withVersion('/favicon.ico?foo=bar')).toBe(
        `/favicon.ico?foo=bar&v=${encodeURIComponent(VERSION)}`
      )
    })
  })
})
