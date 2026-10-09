/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import ListEditLoading from './[id]/edit/loading'
import ListTimelineLoading from './[id]/loading'
import ListsLoading from './loading'
import NewListLoading from './new/loading'

// Each route draws its final layout while it loads: headings and frame outlines
// as shimmer bars, with one polite "Loading" for assistive tech and no other
// text on screen.
describe.each([
  ['lists', ListsLoading, 'Loading lists and collections'],
  ['lists/[id]', ListTimelineLoading, 'Loading list'],
  ['lists/new', NewListLoading, 'Loading list editor'],
  ['lists/[id]/edit', ListEditLoading, 'Loading list editor']
])('%s loading', (_route, Loading, label) => {
  it('draws bars inside frames with one polite Loading', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent(label)
    expect(container.textContent).toBe(label)
    expect(
      container.querySelectorAll('[data-slot="frame"]').length
    ).toBeGreaterThan(0)
    expect(
      container.querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeGreaterThan(0)
  })
})
