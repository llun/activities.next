/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render as baseRender, screen } from '@testing-library/react'
import { ReactElement } from 'react'

import { PageHeaderSectionProvider } from '@/lib/components/page-header'

import OverviewLoading from './(overview)/loading'
import ConnectionsLoading from './connections/loading'
import FilesLoading from './files/loading'
import GearLoading from './gear/[id]/loading'
import GearListLoading from './gear/loading'
import HeatmapLoading from './heatmap/loading'
import PrivacyLoading from './privacy/loading'

// The section layouts wrap their pages in this provider, which makes a page's
// own title an h2 under the layout's one h1.
const render = (ui: ReactElement) =>
  baseRender(<PageHeaderSectionProvider>{ui}</PageHeaderSectionProvider>)

// Every Fitness screen that reads on the server draws its final layout while it
// waits, and announces the wait exactly once: a second status (the overview's
// own skeleton, the gear list's) would make a screen reader say it twice.
describe.each([
  ['overview', OverviewLoading],
  ['gear', GearListLoading],
  ['a gear', GearLoading],
  ['files', FilesLoading],
  ['heatmaps', HeatmapLoading],
  ['privacy', PrivacyLoading],
  ['connections', ConnectionsLoading]
])('fitness %s loading', (_screen, Loading) => {
  it('is busy and announces one polite status', () => {
    const { container } = render(<Loading />)

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(/^Loading/)
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('adds no heading level of its own', () => {
    const { container } = render(<Loading />)

    // The section layout owns the one h1; a loading screen never adds one.
    expect(container.querySelector('h1')).not.toBeInTheDocument()
  })
})

describe('fitness overview loading', () => {
  it('names the overview in its one status', () => {
    render(<OverviewLoading />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading your fitness overview'
    )
  })
})
