/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { ComponentProps } from 'react'

import {
  InlineStatusComposer,
  preloadInlineStatusComposer
} from './lazy-inline-status-composer'

vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default
}))

vi.mock('@/lib/components/posts/inline-status-composer', () => ({
  InlineStatusComposer: () => <div data-testid="composer" />
}))

describe('preloadInlineStatusComposer', () => {
  it('lets the composer render synchronously once preloaded', async () => {
    await act(async () => {
      preloadInlineStatusComposer()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    render(
      <InlineStatusComposer
        {...({} as unknown as ComponentProps<typeof InlineStatusComposer>)}
      />
    )
    expect(screen.getByTestId('composer')).toBeInTheDocument()
  })
})
