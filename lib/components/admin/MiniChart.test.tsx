/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'

import { MiniChart } from './MiniChart'

describe('MiniChart', () => {
  it('fills the area with a gradient that fades from the line colour to transparent', () => {
    const { container } = render(<MiniChart data={[1, 3, 2, 5]} />)

    const gradient = container.querySelector('linearGradient')
    expect(gradient).not.toBeNull()
    const stops = gradient!.querySelectorAll('stop')
    expect(stops).toHaveLength(2)
    expect(stops[0].getAttribute('stop-opacity')).toBe('0.2')
    expect(stops[1].getAttribute('stop-opacity')).toBe('0')

    const [area] = container.querySelectorAll('path')
    expect(area.getAttribute('fill')).toBe(`url(#${gradient!.id})`)
  })

  it('keeps the stroke an even width however the svg is stretched', () => {
    const { container } = render(<MiniChart data={[1, 3, 2, 5]} />)

    const line = container.querySelectorAll('path')[1]
    expect(line.getAttribute('stroke-width')).toBe('1.5')
    expect(line.getAttribute('vector-effect')).toBe('non-scaling-stroke')
  })

  it('gives each chart its own gradient id', () => {
    const { container } = render(
      <>
        <MiniChart data={[1, 2, 3]} />
        <MiniChart data={[3, 2, 1]} />
      </>
    )

    const ids = [...container.querySelectorAll('linearGradient')].map(
      (gradient) => gradient.id
    )
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('draws nothing for fewer than two points', () => {
    const { container } = render(<MiniChart data={[4]} />)
    expect(container.querySelector('path')).toBeNull()
  })
})
