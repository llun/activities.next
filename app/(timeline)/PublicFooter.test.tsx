/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { DomainIdentity } from '@/lib/services/domains/domainIdentity'
import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'

import { PublicFooter } from './PublicFooter'

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://canonical.example'
}))

vi.mock('@/lib/services/domains/domainIdentity', () => ({
  getVisitedDomainIdentity: vi.fn()
}))

const mockIdentity = vi.mocked(getVisitedDomainIdentity)

const policy = { markdown: 'x', updatedAt: null, source: 'server' } as const

const renderFooter = async (overrides: Partial<DomainIdentity>) => {
  mockIdentity.mockResolvedValue({
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
  render(await PublicFooter())
}

describe('PublicFooter', () => {
  it('links the terms and the privacy policy when the domain has them', async () => {
    await renderFooter({ termsOfService: policy, privacyPolicy: policy })

    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      '/terms-of-service'
    )
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      '/privacy-policy'
    )
    expect(screen.getByRole('link', { name: 'Source' })).toBeInTheDocument()
  })

  it('links only the document that is set', async () => {
    await renderFooter({ privacyPolicy: policy })

    expect(screen.queryByRole('link', { name: 'Terms' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeInTheDocument()
  })

  it('has no policy links when neither is set', async () => {
    await renderFooter({})

    expect(screen.queryByRole('link', { name: 'Terms' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Privacy' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Source' })).toBeInTheDocument()
  })
})
