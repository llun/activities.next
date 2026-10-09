/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { MapLoadingOverlay } from './MapLoadingOverlay'

describe('MapLoadingOverlay', () => {
  it('announces the wait once, politely, with no text drawn over the map', () => {
    const { container } = render(<MapLoadingOverlay />)

    const status = screen.getByRole('status')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(status).toHaveTextContent('Loading map')
    expect(container.querySelector('[data-slot="skeleton-bar"]')).not.toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })
})
