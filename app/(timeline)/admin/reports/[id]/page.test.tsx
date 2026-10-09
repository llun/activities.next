/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

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
  getAdminFromSession: vi.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

vi.mock('./AdminReportDetail', () => ({
  AdminReportDetail: ({ reportId }: { reportId: string }) => (
    <div data-testid="report-detail">{reportId}</div>
  )
}))

describe('/admin/reports/[id]', () => {
  it('puts a "Back" to the reports list beside the Report heading', async () => {
    render(await Page({ params: Promise.resolve({ id: 'report-1' }) }))

    const back = screen.getByRole('link', { name: 'Back to reports list' })
    expect(back).toHaveAttribute('href', '/admin/reports')
    expect(within(back).getByText('Back')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Report' })
    ).not.toContainElement(back)
    expect(screen.getByTestId('report-detail')).toHaveTextContent('report-1')
  })
})
