/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import type { AdminAnnouncement } from '@/lib/services/announcements/adminAnnouncement'

import { DomainAnnouncementsBox } from './DomainAnnouncementsBox'

const NOW = Date.parse('2026-10-21T12:00:00.000Z')

const announcement = (
  overrides: Partial<AdminAnnouncement>
): AdminAnnouncement => ({
  id: 'a1',
  domain: 'run.example',
  text: 'Saturday long run at 7:00',
  published: true,
  all_day: false,
  starts_at: null,
  ends_at: Date.parse('2026-10-24T10:00:00.000Z'),
  published_at: NOW,
  created_at: NOW,
  updated_at: NOW,
  ...overrides
})

describe('DomainAnnouncementsBox', () => {
  it('lists the domain announcements with status, domain chip, dates and an Edit link', () => {
    render(
      <DomainAnnouncementsBox
        domain="run.example"
        currentTime={NOW}
        allDomainsCount={0}
        announcements={[
          announcement({}),
          announcement({
            id: 'a2',
            text: 'Spring marathon sign-ups',
            starts_at: Date.parse('2026-11-01T09:00:00.000Z'),
            ends_at: null
          })
        ]}
      />
    )
    const list = screen.getByRole('list', {
      name: 'Announcements on run.example'
    })
    const [first, second] = within(list).getAllByRole('listitem')
    expect(first).toHaveTextContent('Published')
    expect(first).toHaveTextContent('run.example')
    expect(first).toHaveTextContent(/Ends Oct 24, 2026/)
    expect(first).toHaveTextContent('Saturday long run at 7:00')
    expect(second).toHaveTextContent('Scheduled')
    expect(second).toHaveTextContent(/Starts Nov 1, 2026/)
    expect(within(first).getByRole('link', { name: /Edit/ })).toHaveAttribute(
      'href',
      '/admin/announcements#announcement-a1'
    )
  })

  it('truncates a long announcement in the Edit link name', () => {
    render(
      <DomainAnnouncementsBox
        domain="run.example"
        currentTime={NOW}
        allDomainsCount={0}
        announcements={[announcement({ text: 'x'.repeat(200) })]}
      />
    )
    expect(
      screen.getByRole('link', { name: `Edit announcement ${'x'.repeat(80)}…` })
    ).toBeInTheDocument()
  })

  it('says so when the domain has none, and mentions no all-domains line', () => {
    render(
      <DomainAnnouncementsBox
        domain="run.example"
        currentTime={NOW}
        allDomainsCount={0}
        announcements={[]}
      />
    )
    expect(
      screen.getByText('run.example has no announcements of its own.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/for all domains/)).toBeNull()
  })

  it('counts the announcements for all domains with a link', () => {
    const { rerender } = render(
      <DomainAnnouncementsBox
        domain="run.example"
        currentTime={NOW}
        allDomainsCount={1}
        announcements={[]}
      />
    )
    expect(
      screen.getByText(/Also showing 1 announcement for all domains\./)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See it' })).toHaveAttribute(
      'href',
      '/admin/announcements'
    )
    rerender(
      <DomainAnnouncementsBox
        domain="run.example"
        currentTime={NOW}
        allDomainsCount={2}
        announcements={[]}
      />
    )
    expect(
      screen.getByText(/Also showing 2 announcements for all domains\./)
    ).toBeInTheDocument()
  })

  it('opens the announcements form preset to the domain', () => {
    render(
      <DomainAnnouncementsBox
        domain="run.example:8443"
        currentTime={NOW}
        allDomainsCount={0}
        announcements={[]}
      />
    )
    expect(
      screen.getByRole('link', {
        name: 'New announcement for run.example:8443'
      })
    ).toHaveAttribute('href', '/admin/announcements?domain=run.example%3A8443')
  })
})
