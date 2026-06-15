import { renderToStaticMarkup } from 'react-dom/server'

import Page from './page'

const mockDatabase = {}

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
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
