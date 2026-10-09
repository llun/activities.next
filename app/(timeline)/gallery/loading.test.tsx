/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render as baseRender, screen } from '@testing-library/react'
import { ReactElement } from 'react'

import { PageHeaderSectionProvider } from '@/lib/components/page-header'

import SubjectsLoading from './(subjects)/loading'
import AlbumDetailLoading from './albums/[id]/loading'
import AlbumsLoading from './albums/loading'
import GearDetailLoading from './gear/[id]/loading'
import GearLoading from './gear/loading'
import LifeListLoading from './life-list/loading'
import MapLoading from './map/loading'
import PrivacyLoading from './privacy/loading'
import RecentLoading from './recent/loading'
import SubjectLoading from './subjects/[key]/loading'

// The section layouts wrap their pages in this provider, which makes a page's
// own title an h2 under the layout's one h1.
const render = (ui: ReactElement) =>
  baseRender(<PageHeaderSectionProvider>{ui}</PageHeaderSectionProvider>)

// Every Gallery screen draws its final layout while the server reads it (the
// header, the totals strip, the grid of tiles) and announces the wait once.
describe.each([
  ['subjects', SubjectsLoading],
  ['recent', RecentLoading],
  ['albums', AlbumsLoading],
  ['an album', AlbumDetailLoading],
  ['map', MapLoading],
  ['life list', LifeListLoading],
  ['gear', GearLoading],
  ['a piece of gear', GearDetailLoading],
  ['privacy', PrivacyLoading],
  ['a subject', SubjectLoading]
])('gallery %s loading', (_screen, Loading) => {
  it('is busy and announces one polite status', () => {
    const { container } = render(<Loading />)

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(/^Loading/)
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('leaves the one h1 to the layout', () => {
    const { container } = render(<Loading />)

    expect(container.querySelector('h1')).not.toBeInTheDocument()
  })
})

describe('gallery detail screens while loading', () => {
  it('link back to the parent screen while an album or subject loads', () => {
    render(<AlbumDetailLoading />)

    expect(
      screen.getByRole('link', { name: 'Back to albums' })
    ).toHaveAttribute('href', '/gallery/albums')
  })
})
