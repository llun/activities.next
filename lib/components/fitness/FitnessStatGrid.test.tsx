/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FitnessStatGrid } from './FitnessStatGrid'

// jsdom does not evaluate container queries, so the column rule itself can only
// be asserted as the classes that carry it. That is the point: these are the
// design system's breakpoints, and the previous `sm:grid-cols-4` — a VIEWPORT
// query — is exactly what made a 565px column on a tablet render four 28px-value
// tiles side by side.
const getGrid = () => screen.getByTestId('cell').parentElement as HTMLElement

const renderGrid = (props: Parameters<typeof FitnessStatGrid>[0]) =>
  render(<FitnessStatGrid {...props} />)

describe('FitnessStatGrid', () => {
  it('measures its own container rather than the viewport', () => {
    renderGrid({ children: <div data-testid="cell" /> })

    const grid = getGrid()
    expect(grid.parentElement).toHaveClass('@container')
    expect(grid.className).not.toMatch(/(^|\s|:)sm:grid-cols/)
  })

  it('steps the detail strip 1 → 2 → 4 up', () => {
    renderGrid({ children: <div data-testid="cell" /> })

    expect(getGrid()).toHaveClass(
      'grid-cols-1',
      '@min-[420px]:grid-cols-2',
      '@min-[780px]:grid-cols-4'
    )
  })

  it('keeps the post chip at 2 up before going 4 up', () => {
    renderGrid({ variant: 'chip', children: <div data-testid="cell" /> })

    const grid = getGrid()
    // A chip's values are `text-sm`, so four cells still fit in 424px — and a
    // 4-row chip in a feed is a worse trade than a slightly tight cell, so it
    // never drops to a single column.
    expect(grid).toHaveClass('grid-cols-2', '@min-[424px]:grid-cols-4')
    expect(grid).not.toHaveClass('grid-cols-1')
  })

  it('puts the caller class on the container, not the grid', () => {
    renderGrid({ className: 'mt-4', children: <div data-testid="cell" /> })

    expect(getGrid().parentElement).toHaveClass('mt-4')
  })
})
