/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { MediaStripEdges } from './MediaStripEdges'

describe('MediaStripEdges', () => {
  it('names its arrows after the media by default', () => {
    render(
      <MediaStripEdges
        canScrollLeft={false}
        canScrollRight
        onScrollByPage={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Previous media' })
    ).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Next media' })).toHaveAttribute(
      'aria-disabled',
      'false'
    )
  })

  it('names its arrows after what the strip holds and scrolls only where it can', () => {
    const onScrollByPage = vi.fn()
    render(
      <MediaStripEdges
        canScrollLeft
        canScrollRight={false}
        onScrollByPage={onScrollByPage}
        itemsLabel="laps"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Previous laps' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next laps' }))

    expect(onScrollByPage).toHaveBeenCalledTimes(1)
    expect(onScrollByPage).toHaveBeenCalledWith(-1)
  })

  it('draws a smaller arrow and fades in the given colour for a short strip', () => {
    const { container } = render(
      <MediaStripEdges
        canScrollLeft
        canScrollRight
        onScrollByPage={vi.fn()}
        size="small"
        fadeClassName="from-muted"
      />
    )

    expect(screen.getByRole('button', { name: 'Previous media' })).toHaveClass(
      'size-9'
    )
    const fades = container.querySelectorAll('[aria-hidden="true"].absolute')
    expect(fades).toHaveLength(2)
    for (const fade of fades) {
      expect(fade).toHaveClass('from-muted', 'w-12')
      expect(fade).not.toHaveClass('from-background/70')
    }
  })
})
