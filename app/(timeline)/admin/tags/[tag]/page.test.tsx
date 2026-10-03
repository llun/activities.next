/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import Page from './page'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ host: 'llun.test' }))
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({
    getHashtagStatusesPage: vi.fn().mockResolvedValue({
      statuses: [],
      total: 0
    })
  }))
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
  notFound: vi.fn(() => {
    throw new Error('Unexpected notFound')
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

vi.mock('./AdminHashtagPosts', () => ({
  AdminHashtagPosts: () => null
}))

describe('/admin/tags/[tag]', () => {
  it('puts a labelled Back to the hashtags list beside the tag heading', async () => {
    render(
      await Page({
        params: Promise.resolve({ tag: 'fediverse' }),
        searchParams: Promise.resolve({})
      })
    )

    const back = screen.getByRole('link', { name: 'Back to hashtags list' })
    expect(back).toHaveAttribute('href', '/admin/tags')
    expect(within(back).getByText('Back to hashtags')).toHaveClass('md:sr-only')
    expect(
      screen.getByRole('heading', { level: 1, name: 'fediverse' })
    ).not.toContainElement(back)
  })
})
