import { NextRequest } from 'next/server'

import type { Config } from '@/lib/config'

import { GET } from './route'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

const params = { params: Promise.resolve({}) }

const mockConfig = async (overrides: Partial<Config>) => {
  const { getConfig } =
    await vi.importMock<typeof import('@/lib/config')>('@/lib/config')
  getConfig.mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret',
    allowEmails: [],
    ...overrides
  } as unknown as Config)
}

describe('GET /api/v1/instance/privacy_policy', () => {
  it('returns the escaped, paragraph-wrapped policy when configured', async () => {
    await mockConfig({ privacyPolicy: 'No logs & no <trackers>' })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance/privacy_policy'),
      params
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      updated_at: '1970-01-01T00:00:00.000Z',
      content: '<p>No logs &amp; no &lt;trackers&gt;</p>'
    })
  })

  it.each([
    { description: 'unset', privacyPolicy: undefined },
    { description: 'empty', privacyPolicy: '' }
  ])(
    'returns 404 when the policy is $description',
    async ({ privacyPolicy }) => {
      await mockConfig({ privacyPolicy })

      const response = await GET(
        new NextRequest('https://llun.test/api/v1/instance/privacy_policy'),
        params
      )

      expect(response.status).toBe(404)
    }
  )
})
