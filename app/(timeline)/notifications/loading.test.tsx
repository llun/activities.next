/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Loading from './loading'

describe('Notifications loading page', () => {
  it('renders notifications loading skeleton', () => {
    const { container } = render(<Loading />)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThanOrEqual(10)
  })
})
