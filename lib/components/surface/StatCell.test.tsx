/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { Activity } from 'lucide-react'

import { StatCell } from './StatCell'

describe('StatCell', () => {
  it('shows the value over its label', () => {
    render(<StatCell label="Distance" icon={Activity} value="12.3 km" />)
    expect(screen.getByText('12.3 km')).toBeInTheDocument()
    expect(screen.getByText('Distance')).toBeInTheDocument()
  })

  it('shows a dash, never a zero, for a missing value', () => {
    render(<StatCell label="Distance" icon={Activity} value={null} />)
    expect(screen.getByText('–')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toHaveClass('sr-only')
  })

  it('draws a skeleton while loading', () => {
    const { container } = render(
      <StatCell label="Distance" icon={Activity} value={null} loading />
    )
    expect(screen.getByText('Loading')).toHaveClass('sr-only')
    expect(container.querySelector('.skeleton')).not.toBeNull()
    expect(screen.queryByText('Unavailable')).toBeNull()
  })

  it('is not interactive without onSelect', () => {
    render(<StatCell label="Distance" icon={Activity} value="1" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('becomes a toggle button that reports its selection', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <StatCell
        label="Distance"
        icon={Activity}
        value="1"
        onSelect={onSelect}
        selected={false}
      />
    )
    const button = screen.getByRole('button', { name: /Distance/ })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).not.toHaveClass('bg-primary/10')
    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)

    rerender(
      <StatCell
        label="Distance"
        icon={Activity}
        value="1"
        onSelect={onSelect}
        selected
      />
    )
    const pressed = screen.getByRole('button', { name: /Distance/ })
    expect(pressed).toHaveAttribute('aria-pressed', 'true')
    expect(pressed).toHaveClass('bg-primary/10', 'after:bg-primary')
    expect(screen.getByText('1')).toHaveClass('text-primary-text')
  })
})
