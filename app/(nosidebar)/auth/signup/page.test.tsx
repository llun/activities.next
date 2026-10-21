/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import type { DomainIdentity } from '@/lib/services/domains/domainIdentity'
import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { getVisitedSignUpDomain } from '@/lib/services/domains/visitedSignUpDomain'

import Page from './page'

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://canonical.example'
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/services/domains/visitedSignUpDomain', () => ({
  getVisitedSignUpDomain: vi.fn()
}))

vi.mock('@/lib/services/domains/domainIdentity', () => ({
  getVisitedDomainIdentity: vi.fn()
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }
}))

const policy = { markdown: 'x', updatedAt: null, source: 'server' } as const

const renderPage = async (overrides: Partial<DomainIdentity> = {}) => {
  vi.mocked(getVisitedDomainIdentity).mockResolvedValue({
    domain: 'run.example',
    source: 'primary',
    name: 'Run Club',
    description: '',
    contactEmail: '',
    termsOfService: null,
    privacyPolicy: null,
    disabledFeatures: [],
    ...overrides
  })
  render(await Page({}))
}

describe('sign-up page', () => {
  beforeEach(() => {
    vi.mocked(getServerAuthSession).mockResolvedValue(null)
    vi.mocked(getVisitedSignUpDomain).mockResolvedValue({
      open: true,
      domain: 'run.example',
      displayName: 'Run Club'
    } as Awaited<ReturnType<typeof getVisitedSignUpDomain>>)
  })

  it('has no agreement checkbox when the domain has neither document', async () => {
    await renderPage()

    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('requires agreeing to both documents, linked in new tabs', async () => {
    await renderPage({ termsOfService: policy, privacyPolicy: policy })

    const checkbox = screen.getByRole('checkbox', {
      name: 'I agree to the terms of service and privacy policy of Run Club.'
    })
    expect(checkbox).toBeRequired()
    expect(checkbox).toHaveAttribute('name', 'agreement')
    expect(checkbox).toHaveAttribute('value', 'true')

    const terms = screen.getByRole('link', { name: 'terms of service' })
    expect(terms).toHaveAttribute('href', '/terms-of-service')
    expect(terms).toHaveAttribute('target', '_blank')
    expect(terms).toHaveAttribute('rel', expect.stringContaining('noopener'))
    const privacy = screen.getByRole('link', { name: 'privacy policy' })
    expect(privacy).toHaveAttribute('href', '/privacy-policy')
    expect(privacy).toHaveAttribute('target', '_blank')
  })

  it('names only the terms when only they are set', async () => {
    await renderPage({ termsOfService: policy })

    expect(
      screen.getByRole('checkbox', {
        name: 'I agree to the terms of service of Run Club.'
      })
    ).toBeRequired()
    expect(screen.queryByRole('link', { name: 'privacy policy' })).toBeNull()
  })

  it('names only the privacy policy when only it is set', async () => {
    await renderPage({ privacyPolicy: policy })

    expect(
      screen.getByRole('checkbox', {
        name: 'I agree to the privacy policy of Run Club.'
      })
    ).toBeRequired()
    expect(screen.queryByRole('link', { name: 'terms of service' })).toBeNull()
  })
})
