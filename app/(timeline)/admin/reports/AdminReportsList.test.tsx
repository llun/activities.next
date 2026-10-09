/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { getAdminReports } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import { AdminReport } from '@/lib/types/mastodon/admin/report'

import { AdminReportsList } from './AdminReportsList'

vi.mock('@/lib/client', () => ({
  getAdminReports: vi.fn()
}))

const mockGetAdminReports = vi.mocked(getAdminReports)

const report = (overrides: Record<string, unknown>): AdminReport =>
  ({
    id: 'report-1',
    action_taken: false,
    category: 'spam',
    comment: '',
    created_at: '2026-10-01T09:00:00.000Z',
    account: { username: 'reporter', domain: null },
    target_account: { username: 'troll', domain: 'evil.example' },
    statuses: [],
    rules: [],
    ...overrides
  }) as unknown as AdminReport

describe('AdminReportsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists open reports in a table and links each to its detail page', async () => {
    mockGetAdminReports.mockResolvedValue([
      report({}),
      report({
        id: 'report-2',
        category: 'legal',
        account: { username: 'ana', domain: 'far.example' },
        statuses: [{ id: 's1' }, { id: 's2' }] as AdminReport['statuses']
      })
    ])

    render(<AdminReportsList />)

    const table = await screen.findByRole('table', { name: 'Reports' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent)
    ).toEqual(['Reporter', 'Target', 'Category', 'Status', 'Created'])
    expect(mockGetAdminReports).toHaveBeenCalledWith(false)

    const [, first, second] = within(table).getAllByRole('row')
    expect(
      within(first).getByRole('link', { name: 'reporter' })
    ).toHaveAttribute('href', '/admin/reports/report-1')
    // Each value is a cell of its own column (the phone folds them into a
    // second line under the reporter, which is hidden from `sm`).
    const cells = within(first).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('troll@evil.example')
    expect(cells[3]).toHaveTextContent('Open')
    expect(
      within(second).getByRole('link', { name: 'ana@far.example' })
    ).toHaveAttribute('href', '/admin/reports/report-2')
    expect(within(second).getAllByRole('cell')[2]).toHaveTextContent(
      /legal · 2 statuses/
    )
  })

  it('switches between unresolved and resolved with the segmented control', async () => {
    mockGetAdminReports.mockResolvedValue([report({})])
    render(<AdminReportsList />)
    await screen.findByRole('table', { name: 'Reports' })

    expect(screen.getByRole('radio', { name: 'Unresolved' })).toBeChecked()

    mockGetAdminReports.mockResolvedValue([report({ action_taken: true })])
    fireEvent.click(screen.getByRole('radio', { name: 'Resolved' }))

    await waitFor(() => expect(mockGetAdminReports).toHaveBeenCalledWith(true))
    expect(screen.getByRole('radio', { name: 'Resolved' })).toBeChecked()
    const row = (await screen.findAllByRole('row'))[1]
    expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('Resolved')
  })

  it('shows skeleton bars while the reports load, not loading text', async () => {
    const pending = createDeferred<AdminReport[]>()
    mockGetAdminReports.mockReturnValue(pending.promise)
    const { container } = render(<AdminReportsList />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading reports')
    expect(container.textContent).not.toMatch(/Loading reports…/)
    expect(container.querySelector('[data-slot="skeleton-bar"]')).not.toBeNull()

    pending.resolve([report({})])
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('shows a load failure as an alert whose Retry reloads the list', async () => {
    mockGetAdminReports.mockRejectedValueOnce(new Error('Server error'))
    mockGetAdminReports.mockResolvedValueOnce([report({})])
    render(<AdminReportsList />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockGetAdminReports).toHaveBeenCalledTimes(2)
  })

  it('refreshes the current tab on demand', async () => {
    mockGetAdminReports.mockResolvedValue([report({})])
    render(<AdminReportsList />)
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh reports' }))

    await waitFor(() => expect(mockGetAdminReports).toHaveBeenCalledTimes(2))
    expect(mockGetAdminReports).toHaveBeenLastCalledWith(false)
  })

  it('shows an empty state for the tab when there are no reports', async () => {
    mockGetAdminReports.mockResolvedValue([])
    render(<AdminReportsList />)

    expect(await screen.findByText('No open reports.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Resolved' }))
    expect(await screen.findByText('No resolved reports.')).toBeInTheDocument()
  })
})
