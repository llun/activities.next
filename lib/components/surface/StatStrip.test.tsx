/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatStrip } from './StatStrip'

// jsdom never evaluates a container query, so the column thresholds cannot be
// asserted here (and pinning the class strings would only restate the
// constants). What a strip owes its callers is that every cell it is given is
// rendered, whatever the variant.
describe('StatStrip', () => {
  it.each(['detail', 'chip', 'summary', 'counts', 'band'] as const)(
    'renders every cell of the %s variant',
    (variant) => {
      render(
        <StatStrip variant={variant}>
          <div>Distance</div>
          <div>Duration</div>
        </StatStrip>
      )
      expect(screen.getByText('Distance')).toBeInTheDocument()
      expect(screen.getByText('Duration')).toBeInTheDocument()
    }
  )

  it('is a summary strip when no variant is given', () => {
    render(
      <StatStrip columns={2}>
        <div>Distance</div>
        <div>Duration</div>
      </StatStrip>
    )
    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('Duration')).toBeInTheDocument()
  })

  it('holds a lone cell', () => {
    render(
      <StatStrip columns={1}>
        <div>Posts</div>
      </StatStrip>
    )
    expect(screen.getByText('Posts')).toBeInTheDocument()
  })

  // A band's cells sit over a border-coloured track whose 1px gaps are the
  // dividers, so a cell the last row cannot fill would show the track as an
  // empty grey block. The class strings are pinned here for that reason only.
  describe('band variant', () => {
    const gridOf = (count: number) => {
      const { container } = render(
        <StatStrip variant="band" columns={count as 1 | 2 | 3 | 4 | 5}>
          {Array.from({ length: count }, (_, i) => (
            <div key={i}>Cell {i + 1}</div>
          ))}
        </StatStrip>
      )
      return container.querySelector('.grid') as HTMLElement
    }

    it('paints the track but no frame of its own', () => {
      const grid = gridOf(4)
      expect(grid).toHaveClass('gap-px', 'bg-border')
      const wrapper = grid.parentElement as HTMLElement
      expect(wrapper).toHaveClass('@container')
      expect(wrapper.className).not.toMatch(/(^|\s)(border|rounded)/)
    })

    it('is 2 across and 4-up from 560px for four cells', () => {
      const grid = gridOf(4)
      expect(grid).toHaveClass('grid-cols-2', '@min-[560px]:grid-cols-4')
    })

    it('makes the third of three cells span the row so no cell is empty', () => {
      const grid = gridOf(3)
      expect(grid).toHaveClass('grid-cols-2', '@min-[560px]:grid-cols-3')
      expect(grid.className).toContain('[&>*:nth-child(3)]:col-span-2')
      expect(grid.className).not.toContain('grid-cols-4')
    })

    it('is a single full-width column for one cell', () => {
      const grid = gridOf(1)
      expect(grid).toHaveClass('grid-cols-1')
      expect(grid.className).not.toContain('grid-cols-2')
    })
  })
})
