/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  BASE_TIME,
  createMockNote
} from '@/lib/components/posts/__fixtures__/timeline-context'

import { PostHeader } from './post-header'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

const note = (at: number) =>
  createMockNote({
    id: `https://activities.local/users/alice/statuses/n${at}`,
    createdAt: BASE_TIME + at,
    text: 'text'
  })

describe('PostHeader', () => {
  it('shows the span of a combined run', () => {
    render(
      <PostHeader
        status={note(0)}
        lastStatus={note(2 * HOUR)}
        currentTime={BASE_TIME + 6 * HOUR}
        onOpenStatus={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /Open status by/ })
    ).toHaveTextContent('6h – 4h')
  })

  it('shows one time when the run starts and ends in the same unit', () => {
    render(
      <PostHeader
        status={note(0)}
        lastStatus={note(5 * MINUTE)}
        currentTime={BASE_TIME + 6 * HOUR + 10 * MINUTE}
        onOpenStatus={vi.fn()}
      />
    )

    const button = screen.getByRole('button', { name: /Open status by/ })
    expect(button).toHaveTextContent(/^6h$/)
    expect(button).toHaveAccessibleName(/last post about 6 hours ago/)
  })
})
