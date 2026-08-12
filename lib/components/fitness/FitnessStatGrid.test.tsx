/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FitnessStatGrid } from './FitnessStatGrid'

// jsdom never evaluates a container query, so these cover the STRUCTURE the
// rule needs rather than the thresholds themselves — restating
// `VARIANT_CLASS_NAMES` here would only fail when someone edits the constant on
// purpose, and could not catch a hand-rolled strip elsewhere anyway.
const getGrid = () => screen.getByTestId('cell').parentElement as HTMLElement

const renderGrid = (props: Parameters<typeof FitnessStatGrid>[0]) =>
  render(<FitnessStatGrid {...props} />)

describe('FitnessStatGrid', () => {
  it('establishes the container on the wrapper, not on the grid it sizes', () => {
    renderGrid({ children: <div data-testid="cell" /> })

    // Inverting this is the failure mode with no symptom: a container query
    // styles a container's descendants, never the container itself, so a grid
    // that carries `@container` silently keeps its base column count forever.
    const grid = getGrid()
    expect(grid).not.toHaveClass('@container')
    expect(grid.parentElement).toHaveClass('@container')
  })

  it.each(['detail', 'chip'] as const)(
    'sizes the %s variant without a viewport breakpoint',
    (variant) => {
      renderGrid({ variant, children: <div data-testid="cell" /> })

      // The one NEGATIVE invariant worth pinning, and the whole point of the
      // component: a viewport query cannot see a strip sitting in a narrow
      // column on a wide window. Unlike the thresholds — which jsdom cannot
      // evaluate and which restating here would only re-assert — this fails on
      // a real regression, and it is one step away in the same file.
      expect(getGrid().className).not.toMatch(
        /(^|\s|:)(sm|md|lg|xl|2xl):grid-cols/
      )
    }
  )

  it('puts the caller class on the container, not the grid', () => {
    renderGrid({ className: 'mt-4', children: <div data-testid="cell" /> })

    expect(getGrid().parentElement).toHaveClass('mt-4')
    expect(getGrid()).not.toHaveClass('mt-4')
  })

  it('keeps the post chip 2-up where the detail strip goes 1-up', () => {
    renderGrid({ children: <div data-testid="cell" /> })
    const detail = getGrid().className
    screen.getByTestId('cell').remove()
    renderGrid({ variant: 'chip', children: <div data-testid="cell" /> })

    // The two variants deliberately differ at their narrowest: a chip's values
    // are `text-sm`, and a 4-row chip in a feed is a worse trade than a
    // slightly tight cell. Unifying them is the tempting simplification.
    expect(detail).toContain('grid-cols-1')
    expect(getGrid()).toHaveClass('grid-cols-2')
    expect(getGrid()).not.toHaveClass('grid-cols-1')
  })
})
