/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  assignAdminReportToSelf,
  getAdminReport,
  resolveAdminReport
} from '@/lib/client'
import { AdminReport } from '@/lib/types/mastodon/admin/report'

import { AdminReportDetail } from './AdminReportDetail'

vi.mock('@/lib/client', () => ({
  getAdminReport: vi.fn(),
  updateAdminReport: vi.fn(),
  assignAdminReportToSelf: vi.fn(),
  unassignAdminReport: vi.fn(),
  resolveAdminReport: vi.fn(),
  reopenAdminReport: vi.fn()
}))

const mockGetAdminReport = getAdminReport as unknown as ReturnType<typeof vi.fn>
const mockAssign = assignAdminReportToSelf as unknown as ReturnType<
  typeof vi.fn
>
const mockResolve = resolveAdminReport as unknown as ReturnType<typeof vi.fn>

const report = (overrides: Partial<AdminReport>): AdminReport =>
  ({
    id: 'report-1',
    action_taken: false,
    category: 'spam',
    comment: 'unsolicited ads',
    account: { username: 'reporter', domain: null },
    target_account: { username: 'troll', domain: 'evil.example' },
    assigned_account: null,
    action_taken_by_account: null,
    statuses: [],
    rules: [],
    ...overrides
  }) as AdminReport

describe('AdminReportDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the report and drives assign/resolve', async () => {
    mockGetAdminReport.mockResolvedValue(report({}))
    mockAssign.mockResolvedValue(report({}))
    mockResolve.mockResolvedValue(report({ action_taken: true }))

    render(<AdminReportDetail reportId="report-1" />)

    await waitFor(() =>
      expect(screen.getByText('troll@evil.example')).toBeInTheDocument()
    )
    expect(screen.getByText('unsolicited ads')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }))
    await waitFor(() => expect(mockAssign).toHaveBeenCalledWith('report-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('report-1'))
  })
})
