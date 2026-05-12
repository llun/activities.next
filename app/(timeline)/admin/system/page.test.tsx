import { renderToStaticMarkup } from 'react-dom/server'

import Page from './page'

const mockDatabase = {}

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn(() => mockDatabase)
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

jest.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: jest.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

jest.mock('next/navigation', () => ({
  redirect: jest.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

describe('/admin/system', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ACTIVITIES_PUBLIC_VALUE: 'public-value',
      ACTIVITIES_SECRET_TOKEN: 'secret-token'
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('does not render environment variable names or values', async () => {
    const markup = renderToStaticMarkup(await Page())

    expect(markup).not.toContain('Environment Variables')
    expect(markup).not.toContain('ACTIVITIES_')
    expect(markup).not.toContain('ACTIVITIES_PUBLIC_VALUE')
    expect(markup).not.toContain('ACTIVITIES_SECRET_TOKEN')
    expect(markup).not.toContain('public-value')
    expect(markup).not.toContain('secret-token')
  })
})
