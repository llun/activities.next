/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'

import { LandingHero } from './LandingHero'

describe('LandingHero', () => {
  it('loads the decorative watermark eagerly at high priority, not the header logo', () => {
    const { container } = render(<LandingHero serviceName="Activities" />)
    const images = Array.from(container.querySelectorAll('img'))
    expect(images).toHaveLength(2)

    const watermark = images.find(
      (image) => image.getAttribute('width') === '540'
    )
    expect(watermark).toBeDefined()
    expect(watermark).toHaveAttribute('loading', 'eager')
    expect(watermark).toHaveAttribute('fetchpriority', 'high')
    expect(watermark).toHaveAttribute('alt', '')
    expect(watermark).toHaveAttribute('aria-hidden', 'true')
    // `preload` (and the deprecated `priority` it replaces) would emit a <link rel="preload"> as well.
    expect(container.querySelector('link[rel="preload"]')).toBeNull()

    const logo = images.find((image) => image.getAttribute('width') === '44')
    expect(logo).toHaveAttribute('loading', 'lazy')
    expect(logo).not.toHaveAttribute('fetchpriority')
  })
})
