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
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })

  it('draws a skeleton while loading', () => {
    render(<StatCell label="Distance" icon={Activity} value={null} loading />)
    expect(screen.getByText('Loading')).toBeInTheDocument()
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
    expect(button).toHaveAttribute('data-selected', 'false')
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
    expect(pressed).toHaveAttribute('data-selected', 'true')
  })

  it('keeps the label and value readable as one button name, in valid markup', () => {
    const { container } = render(
      <StatCell
        label="Distance"
        icon={Activity}
        value="12.3 km"
        onSelect={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Distance 12.3 km' })
    ).toBeInTheDocument()
    // A button's content is phrasing content: no description list inside it.
    expect(
      container.querySelector('button dl, button dt, button dd')
    ).toBeNull()
  })

  it('keeps the dt/dd label and value semantics when it is not selectable', () => {
    const { container } = render(
      <StatCell label="Distance" icon={Activity} value="12.3 km" />
    )
    expect(container.querySelector('dt')).toHaveTextContent('Distance')
    expect(container.querySelector('dd')).toHaveTextContent('12.3 km')
  })

  it('becomes a link to the list behind the number when given an href', () => {
    render(
      <StatCell
        label="Followers"
        icon={Activity}
        value="30"
        href="/@alice/followers"
        prefetch={false}
      />
    )
    const link = screen.getByRole('link', { name: /Followers/ })
    expect(link).toHaveAttribute('href', '/@alice/followers')
    expect(link).toHaveTextContent('30')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lets onSelect win over href', () => {
    render(
      <StatCell
        label="Distance"
        icon={Activity}
        value="1"
        href="/somewhere"
        onSelect={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: /Distance/ })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
