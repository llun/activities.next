/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { ComponentProps } from 'react'

import { InlineStatusComposer } from './lazy-inline-status-composer'

// The App Router's `next/dynamic` (React.lazy based), which rethrows a failed
// import as a render error; vitest otherwise resolves the Pages Router one.
vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default
}))

vi.mock('@/lib/components/posts/inline-status-composer', () => ({
  get InlineStatusComposer(): never {
    throw new Error('Loading chunk failed')
  }
}))

describe('lazy InlineStatusComposer', () => {
  it('shows an inline message instead of throwing when its chunk fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <InlineStatusComposer
        {...({
          host: 'activities.local',
          mode: 'reply'
        } as unknown as ComponentProps<typeof InlineStatusComposer>)}
      />
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Reload the page to try again.'
    )
  })
})
