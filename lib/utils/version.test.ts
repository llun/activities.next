import { describe, expect, it } from 'vitest'

import { SERVICE_NAME } from '@/lib/constants'
import packageJson from '@/package.json'

import { NODE_INFO_SOFTWARE_NAME, VERSION, withVersion } from './version'

describe('version utils', () => {
  it('exports VERSION matching package.json', () => {
    expect(VERSION).toBe(packageJson.version)
  })

  it('exports NODE_INFO_SOFTWARE_NAME matching schema constraints', () => {
    expect(NODE_INFO_SOFTWARE_NAME).toMatch(/^[a-z0-9-]+$/)
    expect(NODE_INFO_SOFTWARE_NAME).toBe(
      SERVICE_NAME.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    )
  })

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
