import { getBaseURL } from '@/lib/config'
import { TEST_DOMAIN } from '@/lib/stub/const'

import { getBrandAssetSrc } from './getBrandAssetSrc'

describe('getBrandAssetSrc', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the root-relative path in development so it loads from the browser origin', () => {
    vi.stubEnv('NODE_ENV', 'development')

    expect(getBrandAssetSrc('/logo-nav.png')).toBe('/logo-nav.png')
    expect(getBrandAssetSrc('/logo.png')).toBe('/logo.png')
  })

  it('returns an absolute URL on the configured host under test', () => {
    vi.stubEnv('NODE_ENV', 'test')

    expect(getBrandAssetSrc('/logo-nav.png')).toBe(
      `https://${TEST_DOMAIN}/logo-nav.png`
    )
  })

  it('returns an absolute URL on the configured host in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.mocked(getBaseURL).mockReturnValueOnce('https://social.example')

    expect(getBrandAssetSrc('/logo.png')).toBe(
      'https://social.example/logo.png'
    )
  })
})
