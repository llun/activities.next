/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
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

const mockConfig = vi.hoisted(() => ({ push: undefined as unknown }))

vi.mock('@/lib/config', () => ({
  getConfig: () => mockConfig
}))

vi.mock('@/package.json', () => ({ default: { version: '9.8.7' } }))

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

  it('shows the version and push status as a two-cell strip', async () => {
    mockConfig.push = undefined
    render(await Page())

    expect(screen.getByText('9.8.7')).toBeInTheDocument()
    expect(screen.getByText('Version')).toBeInTheDocument()
    expect(screen.getByText('Push notifications')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })

  it('explains an unconfigured push service in an info alert', async () => {
    mockConfig.push = undefined
    render(await Page())

    const alert = screen
      .getByText('Browser push notifications are not configured.')
      .closest('[data-slot="alert"]')
    expect(alert).toHaveAttribute('data-tone', 'info')
    // It is part of the page at load, not news: nothing to announce.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reports push as enabled, with no alert, when it is configured', async () => {
    mockConfig.push = { vapidPublicKey: 'key' }
    render(await Page())

    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
