/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { redirect } from 'next/navigation'

import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import Page from './page'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn()
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

describe('/admin index page', () => {
  it('redirects to / when the session is not an admin', async () => {
    vi.mocked(getAdminFromSession).mockResolvedValue(null)

    await expect(Page()).rejects.toThrow('Unexpected redirect to /')
    expect(redirect).toHaveBeenCalledWith('/')
  })

  it('renders nothing for an admin (the layout renders the index)', async () => {
    vi.mocked(getAdminFromSession).mockResolvedValue({
      id: 'admin'
    } as Awaited<ReturnType<typeof getAdminFromSession>>)

    expect(await Page()).toBeNull()
    expect(redirect).not.toHaveBeenCalled()
  })
})
