/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import AccountDetailLoading from './accounts/[id]/loading'
import AccountsLoading from './accounts/loading'
import AnnouncementsLoading from './announcements/loading'
import EmojisLoading from './emojis/loading'
import FederationLoading from './federation/loading'
import FiltersLoading from './filters/loading'
import InstanceLoading from './instance/loading'
import AdminOverviewLoading from './loading'
import NetworkLoading from './network/loading'
import PostsLoading from './posts/loading'
import QueuesLoading from './queues/loading'
import RelaysLoading from './relays/loading'
import ReportDetailLoading from './reports/[id]/loading'
import ReportsLoading from './reports/loading'
import RulesLoading from './rules/loading'
import SystemLoading from './system/loading'
import TagDetailLoading from './tags/[tag]/loading'
import TagsLoading from './tags/loading'

// Every Admin route draws its final layout while it loads: headings and frame
// outlines as shimmer bars, with one polite "Loading" for assistive tech and
// no text on screen.
describe.each([
  ['admin', AdminOverviewLoading],
  ['admin/accounts', AccountsLoading],
  ['admin/accounts/[id]', AccountDetailLoading],
  ['admin/announcements', AnnouncementsLoading],
  ['admin/emojis', EmojisLoading],
  ['admin/federation', FederationLoading],
  ['admin/filters', FiltersLoading],
  ['admin/instance', InstanceLoading],
  ['admin/network', NetworkLoading],
  ['admin/posts', PostsLoading],
  ['admin/queues', QueuesLoading],
  ['admin/relays', RelaysLoading],
  ['admin/reports', ReportsLoading],
  ['admin/reports/[id]', ReportDetailLoading],
  ['admin/rules', RulesLoading],
  ['admin/system', SystemLoading],
  ['admin/tags', TagsLoading],
  ['admin/tags/[tag]', TagDetailLoading]
])('%s loading', (_route, Loading) => {
  it('draws the page as bars inside frames with one polite Loading', () => {
    const { container } = render(<Loading />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/^Loading/)
    expect(container.textContent).toBe(status.textContent)
    expect(
      container.querySelectorAll('[data-slot="frame"]').length
    ).toBeGreaterThan(0)
    expect(
      container.querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeGreaterThan(0)
  })
})
