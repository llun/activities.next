/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import Page from './page'

const getDomainBlocks = vi.fn()
const getDomainAllows = vi.fn()
const getDomainFederationRuleStats = vi.fn()
const mockDatabase = {
  getDomainBlocks,
  getDomainAllows,
  getDomainFederationRuleStats
}

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ allowMediaDomains: [] }))
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

vi.mock('@/lib/services/serverSettings', () => ({
  getServerSettingsView: vi.fn().mockResolvedValue({
    settings: {
      federation: { mode: 'open', allowActorDomains: [] }
    },
    locks: {}
  })
}))

vi.mock('@/lib/components/admin/settings/FederationPolicyForm', () => ({
  FederationPolicyForm: () => <section aria-label="Federation policy form" />
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

vi.mock('@/app/(timeline)/admin/federation/actions', () => ({
  createDomainAllowAction: vi.fn(),
  createDomainBlockAction: vi.fn(),
  deleteDomainAllowAction: vi.fn(),
  deleteDomainBlockAction: vi.fn(),
  importKnownDomainBlocklistAction: vi.fn()
}))

const block = (id: string, domain: string, severity = 'suspend') => ({
  id,
  domain,
  severity,
  publicComment: null
})

const renderPage = async (params: Record<string, string> = {}) =>
  render(await Page({ searchParams: Promise.resolve(params) }))

describe('/admin/federation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDomainBlocks.mockResolvedValue([])
    getDomainAllows.mockResolvedValue([])
    getDomainFederationRuleStats.mockResolvedValue({
      blocks: 0,
      allows: 0,
      sourceBlocks: 0,
      sourceCounts: {}
    })
  })

  it('says how many domains are blocked, allowed and imported', async () => {
    getDomainFederationRuleStats.mockResolvedValue({
      blocks: 1204,
      allows: 3,
      sourceBlocks: 1000,
      sourceCounts: {}
    })
    await renderPage()

    expect(screen.getByText('Blocked domains').parentElement).toHaveTextContent(
      '1,204'
    )
    expect(screen.getByText('Allowed domains').parentElement).toHaveTextContent(
      '3'
    )
    expect(
      screen.getByText('Shared-list entries').parentElement
    ).toHaveTextContent('1,000')
  })

  it('shows an empty state for blocks and allows', async () => {
    await renderPage()

    expect(screen.getByText('No domains blocked')).toBeInTheDocument()
    expect(screen.getByText('No domains allowed')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Domain blocks' })).toBeNull()
  })

  it('has a labelled block form with the same field names', async () => {
    await renderPage()

    expect(
      screen.getByLabelText('Domain', { selector: '#block-domain' })
    ).toHaveAttribute('name', 'domain')
    expect(screen.getByLabelText('Severity')).toHaveAttribute(
      'name',
      'severity'
    )
    expect(screen.getByLabelText('Public comment')).toHaveAttribute(
      'name',
      'publicComment'
    )
    expect(screen.getByLabelText('Private comment')).toHaveAttribute(
      'name',
      'privateComment'
    )
    expect(screen.getByLabelText('Reject media')).toHaveAttribute(
      'name',
      'rejectMedia'
    )
    expect(screen.getByLabelText('Reject reports')).toHaveAttribute(
      'name',
      'rejectReports'
    )
    expect(screen.getByLabelText('Obfuscate')).toHaveAttribute(
      'name',
      'obfuscate'
    )
    expect(screen.getByRole('button', { name: 'Save block' })).toHaveAttribute(
      'type',
      'submit'
    )
  })

  it('describes the severity choice for assistive tech', async () => {
    await renderPage()

    expect(screen.getByLabelText('Severity')).toHaveAccessibleDescription(
      /Only Suspend rejects federation/
    )
  })

  it('lists blocks with a delete button named after the domain', async () => {
    getDomainBlocks.mockResolvedValue([
      block('b1', 'spam.example'),
      { ...block('b2', 'meh.example', 'silence'), publicComment: 'noisy' }
    ])
    getDomainFederationRuleStats.mockResolvedValue({
      blocks: 2,
      allows: 0,
      sourceBlocks: 0,
      sourceCounts: {}
    })
    await renderPage()

    const list = screen.getByRole('list', { name: 'Domain blocks' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('silence - noisy')).toBeInTheDocument()
    expect(
      within(list).getByRole('button', {
        name: 'Delete block for spam.example'
      })
    ).toHaveAttribute('type', 'submit')
  })

  it('links to the next page of blocks and keeps the allow offset', async () => {
    getDomainBlocks.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => block(`b${i}`, `d${i}.example`))
    )
    getDomainFederationRuleStats.mockResolvedValue({
      blocks: 250,
      allows: 0,
      sourceBlocks: 0,
      sourceCounts: {}
    })
    await renderPage({ allowOffset: '100' })

    const nav = screen.getByRole('navigation', {
      name: 'Domain blocks pagination'
    })
    expect(
      within(nav).getByText('Showing 1-100 of 250 blocked domains')
    ).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Next/ })).toHaveAttribute(
      'href',
      '/admin/federation?blockOffset=100&allowOffset=100'
    )
    expect(within(nav).getByRole('button', { name: /Previous/ })).toBeDisabled()
  })

  it('shows a saved status as a success alert and a failure as an error', async () => {
    const { unmount } = await renderPage({ status: 'block-saved' })
    expect(
      screen.getByText('Domain block saved').closest('[data-slot="alert"]')
    ).toHaveAttribute('data-tone', 'success')
    unmount()

    await renderPage({ status: 'invalid-block-domain' })
    expect(
      screen
        .getByText('Enter a valid domain to block')
        .closest('[data-slot="alert"]')
    ).toHaveAttribute('data-tone', 'error')
  })

  it('reports how many entries an import added', async () => {
    await renderPage({ status: 'imported-1-2-3' })

    expect(
      screen.getByText('Imported 1 new block, updated 2, skipped 3')
    ).toBeInTheDocument()
  })
})
