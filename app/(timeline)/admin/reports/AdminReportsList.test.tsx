/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getAdminReports } from '@/lib/client'
import { AdminReport } from '@/lib/types/mastodon/admin/report'

import { AdminReportsList } from './AdminReportsList'

vi.mock('@/lib/client', () => ({
  getAdminReports: vi.fn()
}))

const mockGetAdminReports = getAdminReports as unknown as ReturnType<
  typeof vi.fn
>

const report = (overrides: Partial<AdminReport>): AdminReport =>
  ({
    id: 'report-1',
    action_taken: false,
    category: 'spam',
    comment: '',
    account: { username: 'reporter', domain: null },
    target_account: { username: 'troll', domain: 'evil.example' },
    statuses: [],
    rules: [],
    ...overrides
  }) as AdminReport

describe('AdminReportsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists open reports and toggles to resolved', async () => {
    mockGetAdminReports.mockResolvedValue([report({})])

    render(<AdminReportsList />)

    await waitFor(() =>
      expect(
        screen.getByText('reporter → troll@evil.example')
      ).toBeInTheDocument()
    )
    expect(mockGetAdminReports).toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }))
    await waitFor(() => expect(mockGetAdminReports).toHaveBeenCalledWith(true))
  })

  it('shows an empty state when there are no reports', async () => {
    mockGetAdminReports.mockResolvedValue([])
    render(<AdminReportsList />)
    await waitFor(() =>
      expect(screen.getByText('No open reports.')).toBeInTheDocument()
    )
  })
})
