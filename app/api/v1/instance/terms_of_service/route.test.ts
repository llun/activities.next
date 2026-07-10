import { NextRequest } from 'next/server'

import type { Config } from '@/lib/config'

import { GET as GET_BY_DATE } from './[date]/route'
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

describe('GET /api/v1/instance/terms_of_service', () => {
  it('returns the TermsOfService entity when configured', async () => {
    await mockConfig({ termsOfService: 'Be excellent & <fair>' })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance/terms_of_service'),
      params
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      effective_date: '1970-01-01',
      effective: true,
      content: '<p>Be excellent &amp; &lt;fair&gt;</p>',
      succeeded_by: null
    })
  })

  it.each([
    { description: 'unset', termsOfService: undefined },
    { description: 'empty', termsOfService: '' }
  ])(
    'returns 404 when the terms are $description',
    async ({ termsOfService }) => {
      await mockConfig({ termsOfService })

      const response = await GET(
        new NextRequest('https://llun.test/api/v1/instance/terms_of_service'),
        params
      )

      expect(response.status).toBe(404)
    }
  )
})

describe('GET /api/v1/instance/terms_of_service/[date]', () => {
  const requestByDate = (date: string) =>
    GET_BY_DATE(
      new NextRequest(
        `https://llun.test/api/v1/instance/terms_of_service/${date}`
      ),
      { params: Promise.resolve({ date }) }
    )

  it('serves the single configured version by its effective date', async () => {
    await mockConfig({ termsOfService: 'Be excellent' })

    const response = await requestByDate('1970-01-01')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      effective_date: '1970-01-01',
      effective: true
    })
  })

  it.each([
    {
      description: 'an unknown effective date',
      termsOfService: 'Be excellent',
      date: '2024-01-01'
    },
    {
      description: 'no configured terms',
      termsOfService: undefined,
      date: '1970-01-01'
    }
  ])('returns 404 for $description', async ({ termsOfService, date }) => {
    await mockConfig({ termsOfService })

    const response = await requestByDate(date)

    expect(response.status).toBe(404)
  })
})
