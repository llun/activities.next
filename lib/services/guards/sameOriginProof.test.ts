import { NextRequest } from 'next/server'

import { TEST_DOMAIN } from '@/lib/stub/const'
import { logger } from '@/lib/utils/logger'

import {
  hasSameOriginProof,
  hasSameOriginProofQuietly
} from './sameOriginProof'

vi.mock('@/lib/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const post = (headers: Record<string, string> = {}) =>
  new NextRequest(`https://${TEST_DOMAIN}/api/v1/anything`, {
    method: 'POST',
    headers
  })

describe('same-origin proof', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear()
  })

  it.each([
    [
      'an Origin on the base origin',
      { Origin: `https://${TEST_DOMAIN}` },
      true
    ],
    [
      'a Referer on the base origin',
      { Referer: `https://${TEST_DOMAIN}/home` },
      true
    ],
    ['a foreign Origin', { Origin: 'https://evil.example' }, false],
    [
      'a foreign Origin beside a base Referer',
      { Origin: 'https://evil.example', Referer: `https://${TEST_DOMAIN}/` },
      false
    ],
    ['an unparseable Origin', { Origin: 'not a url' }, false],
    ['neither header', {}, false]
  ])('judges a POST with %s', (_, headers, expected) => {
    expect(hasSameOriginProof(post(headers))).toBe(expected)
    expect(hasSameOriginProofQuietly(post(headers))).toBe(expected)
  })

  it('does not require proof on a safe method', () => {
    const req = new NextRequest(`https://${TEST_DOMAIN}/x`, { method: 'GET' })

    expect(hasSameOriginProof(req)).toBe(true)
    expect(hasSameOriginProofQuietly(req)).toBe(true)
  })

  it('warns about a rejection, except through the quiet variant', () => {
    hasSameOriginProofQuietly(post({ Origin: 'https://evil.example' }))
    expect(logger.warn).not.toHaveBeenCalled()

    hasSameOriginProof(post({ Origin: 'https://evil.example' }))
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
