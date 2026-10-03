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

  it('draws the status pill as the shared Badge: primary while open, gray once resolved', async () => {
    mockGetAdminReports.mockResolvedValue([report({})])
    render(<AdminReportsList />)

    const row = await screen.findByRole('link', {
      name: /reporter → troll@evil.example/
    })
    const open = within(row).getByText('Open')
    expect(open).toHaveClass('bg-primary/10', 'text-primary-text')
    // The design's dark tint is what the hand-rolled pill never had.
    expect(open.className).toContain('dark:bg-[#FA802E]/16')

    mockGetAdminReports.mockResolvedValue([report({ action_taken: true })])
    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }))
    // The toggle is a button; the pill is the span.
    const resolved = await screen.findByText('Resolved', { selector: 'span' })
    expect(resolved).toHaveClass('bg-muted', 'text-muted-foreground')
    expect(resolved.className).toContain('dark:bg-[#383838]')
    expect(resolved).toHaveClass('shrink-0')
  })

  it('shows an empty state when there are no reports', async () => {
    mockGetAdminReports.mockResolvedValue([])
    render(<AdminReportsList />)
    await waitFor(() =>
      expect(screen.getByText('No open reports.')).toBeInTheDocument()
    )
  })
})
