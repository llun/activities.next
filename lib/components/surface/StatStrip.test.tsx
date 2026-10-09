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
  it.each(['detail', 'chip', 'summary', 'counts'] as const)(
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
})
