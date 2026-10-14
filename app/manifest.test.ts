import { describe, expect, it } from 'vitest'

import { VERSION } from '@/lib/utils/version'

import manifest from './manifest'

describe('manifest', () => {
  it('exports versioned app icons to invalidate caches', () => {
    const m = manifest()
    expect(m.start_url).toBe('/app')
    expect(m.scope).toBe('/')
    const v = encodeURIComponent(VERSION)
    expect(m.icons).toEqual([
      {
        src: `/icon-192.png?v=${v}`,
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: `/icon-512.png?v=${v}`,
        sizes: '512x512',
        type: 'image/png'
      }
    ])
  })
})
