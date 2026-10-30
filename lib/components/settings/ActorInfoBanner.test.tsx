/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ActorInfoBanner } from './ActorInfoBanner'

describe('ActorInfoBanner', () => {
  it('is an info Alert, a polite status', () => {
    render(<ActorInfoBanner actorHandle="@test@domain.com" />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveAttribute('data-tone', 'info')
  })
})
