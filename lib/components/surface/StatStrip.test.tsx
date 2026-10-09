/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatStrip } from './StatStrip'

// jsdom never evaluates a container query, so these cover the STRUCTURE the
// rule needs rather than the thresholds themselves — restating
// `VARIANT_CLASS_NAMES` here would only fail when someone edits the constant on
// purpose, and could not catch a hand-rolled strip elsewhere anyway.
const getGrid = () => screen.getByTestId('cell').parentElement as HTMLElement

const renderGrid = (props: Parameters<typeof StatStrip>[0]) =>
  render(<StatStrip {...props} />)

describe('StatStrip', () => {
  it('establishes the container on the wrapper, not on the grid it sizes', () => {
    renderGrid({ children: <div data-testid="cell" /> })

    // Inverting this is the failure mode with no symptom: a container query
    // styles a container's descendants, never the container itself, so a grid
    // that carries `@container` silently keeps its base column count forever.
    const grid = getGrid()
    expect(grid).not.toHaveClass('@container')
    expect(grid.parentElement).toHaveClass('@container')
  })

  it.each(['detail', 'chip', 'summary'] as const)(
    'sizes the %s variant without a viewport breakpoint',
    (variant) => {
      renderGrid({ variant, children: <div data-testid="cell" /> })

      // The one NEGATIVE invariant worth pinning, and the whole point of the
      // component: a viewport query cannot see a strip sitting in a narrow
      // column on a wide window. Unlike the thresholds — which jsdom cannot
      // evaluate and which restating here would only re-assert — this fails on
      // a real regression, and it is one step away in the same file.
      //
      // It asserts every variant on a `grid-cols` is `@`-prefixed rather than
      // naming the viewport breakpoints, because the regression that actually
      // threatens this file is not someone typing `sm:` back in — it is losing
      // ONE character. `min-[420px]:` is a perfectly valid Tailwind v4
      // *viewport* variant that compiles to `@media (width >= 420px)` where
      // `@min-[420px]:` compiles to `@container (…)`, with no build error, no
      // lint error, and nothing on screen to show for it until someone opens a
      // tablet. `max-sm:` slips past a breakpoint-name list too.
      expect(getGrid().className).not.toMatch(/(^|\s)[^\s@]+:grid-cols/)
    }
  )

  it('puts the caller class on the container, not the grid', () => {
    renderGrid({ className: 'mt-4', children: <div data-testid="cell" /> })

    expect(getGrid().parentElement).toHaveClass('mt-4')
    expect(getGrid()).not.toHaveClass('mt-4')
  })

  it('keeps the post chip 2-up where the detail strip goes 1-up', () => {
    renderGrid({ variant: 'detail', children: <div data-testid="cell" /> })
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

  it('draws the hairline track on the summary strip only', () => {
    renderGrid({ children: <div data-testid="cell" /> })
    const summary = getGrid().parentElement as HTMLElement
    // The 1px grid gap over a `bg-border` track is what draws the dividers, so
    // the strip carries it itself and callers cannot forget it.
    expect(summary).toHaveClass('bg-border', 'rounded-lg', 'border')

    screen.getByTestId('cell').remove()
    renderGrid({ variant: 'detail', children: <div data-testid="cell" /> })
    expect(getGrid().parentElement).not.toHaveClass('bg-border')
  })

  it('keeps the overview summary 2×2 at the default text size, in rem so it follows text zoom', () => {
    renderGrid({ variant: 'summary', children: <div data-testid="cell" /> })

    // 2×2 on a phone (16rem = 256px, so even a 320px phone's 288px column),
    // four-up from 43.75rem (700px). Both thresholds are `rem`: at 200% text
    // 16rem is 512px, so a 358px column stacks to ONE column instead of
    // clipping "22.2 km" to "22.2 kr", and four-up waits for 1400px. A `px`
    // threshold here is the regression. The 1px gap is the contract the
    // dividers rely on.
    const classes = getGrid().className
    expect(getGrid()).toHaveClass('gap-px', 'grid-cols-1')
    expect(classes).toMatch(/(^|\s)@min-\[16rem\]:grid-cols-2/)
    expect(classes).toMatch(/(^|\s)@min-\[43\.75rem\]:grid-cols-4/)
    expect(classes).not.toMatch(/@min-\[\d+px\]/)
  })

  it.each([2, 3] as const)(
    'spans a %i-value summary strip over exactly that many columns, never four',
    (columns) => {
      renderGrid({
        variant: 'summary',
        columns,
        children: <div data-testid="cell" />
      })

      // Four columns with fewer cells leaves an empty, border-coloured cell at
      // the end of the hairline strip.
      const classes = getGrid().className
      expect(getGrid()).toHaveClass('gap-px', 'grid-cols-1')
      expect(classes).not.toMatch(/grid-cols-4/)
      expect(classes).toMatch(
        new RegExp(`(^|\\s)@min-\\[[\\d.]+rem\\]:grid-cols-${columns}`)
      )
      expect(classes).not.toMatch(/@min-\[\d+px\]/)
    }
  )
})
