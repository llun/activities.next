/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render as baseRender, screen } from '@testing-library/react'
import { Images } from 'lucide-react'
import { ReactElement } from 'react'

import { PageHeaderSectionProvider } from '@/lib/components/page-header'

import {
  DescriptionSkeleton,
  ScreenSkeleton,
  StatStripSkeleton
} from './ScreenSkeleton'

// The section layouts wrap their pages in this provider, which makes a page's
// own title an h2 under the layout's one h1.
const render = (ui: ReactElement) =>
  baseRender(<PageHeaderSectionProvider>{ui}</PageHeaderSectionProvider>)

describe('ScreenSkeleton', () => {
  it("announces the label as the screen's one polite status", () => {
    render(<ScreenSkeleton label="Loading albums">body</ScreenSkeleton>)

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Loading albums')
  })

  it('adds no status when the body brings its own', () => {
    render(
      <ScreenSkeleton>
        <p role="status">Loading gear</p>
      </ScreenSkeleton>
    )

    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('draws the title as a bar in an h2 (the layout owns the h1)', () => {
    const { container } = render(<ScreenSkeleton label="Loading" />)

    const title = container.querySelector('h2')
    expect(title).toBeInTheDocument()
    expect(title?.textContent).toBe('')
    expect(
      title?.querySelector('[data-slot="skeleton-bar"]')
    ).toBeInTheDocument()
    expect(container.querySelector('h1')).not.toBeInTheDocument()
  })

  it('leaves out the description when told to', () => {
    const { container } = render(
      <ScreenSkeleton label="Loading" description={false} />
    )

    expect(
      container.querySelectorAll('[data-slot="skeleton-bar"]')
    ).toHaveLength(1)
  })

  it('draws the actions at the end of the title row', () => {
    render(
      <ScreenSkeleton label="Loading" actions={<span>actions here</span>} />
    )

    expect(screen.getByText('actions here')).toBeInTheDocument()
  })
})

describe('DescriptionSkeleton', () => {
  it('draws one bar per wrapped line', () => {
    const { container } = render(<DescriptionSkeleton lines={3} />)

    expect(
      container.querySelectorAll('[data-slot="skeleton-bar"]')
    ).toHaveLength(3)
  })

  it('draws the longer of two line counts', () => {
    const { container } = render(<DescriptionSkeleton lines={[4, 2]} />)

    expect(
      container.querySelectorAll('[data-slot="skeleton-bar"]')
    ).toHaveLength(4)
  })
})

describe('StatStripSkeleton', () => {
  it("keeps the loaded strip's cells and labels, with no value and no status of its own", () => {
    render(
      <StatStripSkeleton
        cells={[
          { label: 'Photos', icon: Images },
          { label: 'Species', icon: Images }
        ]}
      />
    )

    expect(screen.getByText('Photos')).toBeInTheDocument()
    expect(screen.getByText('Species')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
