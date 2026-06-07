import { NextRequest } from 'next/server'

import { OPTIONS, PATCH, PUT } from './route'

jest.mock('@/lib/database', () => ({
  getDatabase: () => null,
  getKnex: () => () => ({})
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn().mockResolvedValue(null)
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('PATCH /api/v2/filters/:id', () => {
  // Rails `resources` maps update to both PATCH and PUT, so Mastodon clients may
  // send either. Binding PATCH to the same handler reference is the strongest
  // guarantee that both verbs behave identically and that PATCH no longer 405s.
  it('binds PATCH to the same handler as PUT', () => {
    expect(typeof PATCH).toBe('function')
    expect(PATCH).toBe(PUT)
  })

  it('advertises PATCH in the OPTIONS Access-Control-Allow-Methods header', async () => {
    const response = await OPTIONS(
      new NextRequest('https://llun.test/api/v2/filters/filter-1', {
        method: 'OPTIONS',
        headers: { origin: 'https://llun.test' }
      })
    )

    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'PATCH'
    )
  })
})
