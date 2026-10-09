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

import {
  assignAdminReportToSelf,
  getAdminReport,
  reopenAdminReport,
  resolveAdminReport,
  unassignAdminReport,
  updateAdminReport
} from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
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
const mockReopen = reopenAdminReport as unknown as ReturnType<typeof vi.fn>
const mockUnassign = unassignAdminReport as unknown as ReturnType<typeof vi.fn>
const mockUpdate = updateAdminReport as unknown as ReturnType<typeof vi.fn>

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
    // clearAllMocks keeps implementations: drop the pending promise the
    // category-lock test leaves on the mock so it cannot reach a later test.
    mockUpdate.mockReset()
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

  it('reopens a resolved report and unassigns an assigned one', async () => {
    mockGetAdminReport.mockResolvedValue(
      report({
        action_taken: true,
        assigned_account: { username: 'mod', domain: null } as never
      })
    )
    mockReopen.mockResolvedValue(report({}))
    mockUnassign.mockResolvedValue(report({}))

    render(<AdminReportDetail reportId="report-1" />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(mockReopen).toHaveBeenCalledWith('report-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Unassign' }))
    await waitFor(() => expect(mockUnassign).toHaveBeenCalledWith('report-1'))
  })

  it('updates the category from the select', async () => {
    mockGetAdminReport.mockResolvedValue(report({}))
    mockUpdate.mockResolvedValue(report({ category: 'violation' }))

    render(<AdminReportDetail reportId="report-1" />)
    await waitFor(() =>
      expect(screen.getByText('troll@evil.example')).toBeInTheDocument()
    )

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'violation' }
    })
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        id: 'report-1',
        category: 'violation'
      })
    )
  })

  it('offers the four categories in the labelled category select', async () => {
    mockGetAdminReport.mockResolvedValue(report({ category: 'legal' }))

    render(<AdminReportDetail reportId="report-1" />)
    await waitFor(() =>
      expect(screen.getByText('troll@evil.example')).toBeInTheDocument()
    )

    const select = screen.getByRole('combobox', { name: 'Category' })
    expect(select.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option')).toHaveLength(4)
    expect(select).toHaveValue('legal')
  })

  it('lays the facts out as label and value rows', async () => {
    mockGetAdminReport.mockResolvedValue(
      report({
        assigned_account: { username: 'mod', domain: null } as never
      })
    )

    render(<AdminReportDetail reportId="report-1" />)

    const details = (
      await screen.findByRole('heading', { level: 2, name: 'Details' })
    ).closest('section') as HTMLElement
    expect(
      within(details)
        .getAllByRole('term')
        .map((term) => term.textContent)
    ).toEqual([
      'Reporter',
      'Target',
      'Category',
      'Status',
      'Assigned to',
      'Comment'
    ])
    expect(within(details).getByText('reporter')).toBeInTheDocument()
    expect(within(details).getByText('Open')).toBeInTheDocument()
    expect(within(details).getByText('mod')).toBeInTheDocument()
    expect(within(details).getByText('unsolicited ads')).toBeInTheDocument()
  })

  it('lists the broken rules and reported statuses when there are any', async () => {
    mockGetAdminReport.mockResolvedValue(
      report({
        rules: [{ id: 'r1', text: 'No spam' }] as AdminReport['rules'],
        statuses: [
          { id: 's1', url: 'https://llun.test/@troll/1' }
        ] as AdminReport['statuses']
      })
    )

    render(<AdminReportDetail reportId="report-1" />)

    const rules = await screen.findByRole('list', { name: 'Broken rules' })
    expect(within(rules).getByText('No spam')).toBeInTheDocument()
    const statuses = screen.getByRole('list', { name: 'Reported statuses' })
    expect(
      within(statuses).getByRole('link', { name: 'https://llun.test/@troll/1' })
    ).toHaveAttribute('href', 'https://llun.test/@troll/1')
  })

  it('leaves out the rules and statuses sections when there are none', async () => {
    mockGetAdminReport.mockResolvedValue(report({}))

    render(<AdminReportDetail reportId="report-1" />)
    await screen.findByRole('heading', { level: 2, name: 'Moderation' })

    expect(screen.queryByRole('list', { name: 'Broken rules' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Reported statuses' })).toBeNull()
  })

  it('draws a skeleton while the report loads, not text', async () => {
    const pending = createDeferred<AdminReport>()
    mockGetAdminReport.mockReturnValue(pending.promise)

    const { container } = render(<AdminReportDetail reportId="report-1" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading report')
    expect(container.textContent).toBe('Loading report')
    pending.resolve(report({}))
    expect(await screen.findByText('troll@evil.example')).toBeInTheDocument()
  })

  it('shows a load failure as an alert whose Retry loads the report again', async () => {
    mockGetAdminReport.mockRejectedValueOnce(new Error('Report not found'))
    mockGetAdminReport.mockResolvedValueOnce(report({}))

    render(<AdminReportDetail reportId="report-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Report not found'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('troll@evil.example')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockGetAdminReport).toHaveBeenCalledTimes(2)
  })

  it('keeps the report and shows an alert when an action fails', async () => {
    mockGetAdminReport.mockResolvedValue(report({}))
    mockResolve.mockRejectedValue(new Error('Could not resolve'))

    render(<AdminReportDetail reportId="report-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not resolve'
    )
    expect(screen.getByText('troll@evil.example')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeEnabled()
  })

  it('locks the category select while an action is in flight', async () => {
    mockGetAdminReport.mockResolvedValue(report({}))
    const update = createDeferred<AdminReport>()
    mockUpdate.mockReturnValue(update.promise)

    render(<AdminReportDetail reportId="report-1" />)
    await waitFor(() =>
      expect(screen.getByText('troll@evil.example')).toBeInTheDocument()
    )
    expect(screen.getByRole('combobox')).toBeEnabled()

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'legal' }
    })
    await waitFor(() => expect(screen.getByRole('combobox')).toBeDisabled())

    update.resolve(report({ category: 'legal' }))
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
  })
})
