/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { DomainReportsBox } from './DomainReportsBox'

describe('DomainReportsBox', () => {
  it('counts the open reports and links to the list filtered by the domain', () => {
    render(<DomainReportsBox domain="run.example" openReports={3} />)
    expect(
      screen.getByText('3 open reports about profiles on run.example')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View reports' })).toHaveAttribute(
      'href',
      '/admin/reports?domain=run.example'
    )
  })

  it('uses the singular for one report and words zero', () => {
    const { rerender } = render(
      <DomainReportsBox domain="social.example" openReports={1} />
    )
    expect(
      screen.getByText('1 open report about profiles on social.example')
    ).toBeInTheDocument()
    rerender(<DomainReportsBox domain="social.example" openReports={0} />)
    expect(
      screen.getByText('No open reports about profiles on social.example')
    ).toBeInTheDocument()
  })

  it('encodes a domain with a port in the link', () => {
    render(<DomainReportsBox domain="run.example:8443" openReports={2} />)
    expect(screen.getByRole('link', { name: 'View reports' })).toHaveAttribute(
      'href',
      '/admin/reports?domain=run.example%3A8443'
    )
  })

  it('shows a capped count as n+', () => {
    render(<DomainReportsBox domain="run.example" openReports={1000} capped />)
    expect(
      screen.getByText('1000+ open reports about profiles on run.example')
    ).toBeInTheDocument()
  })
})
