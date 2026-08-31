/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  ComposerSkeleton,
  NotificationRowSkeleton,
  PageHeaderSkeleton,
  PostSkeleton,
  ProfileHeaderSkeleton,
  Skeleton,
  UserRowSkeleton
} from './skeleton'

describe('Skeleton UI components', () => {
  it('renders base Skeleton with shimmer classes and data-slot', () => {
    const { container } = render(<Skeleton className="h-4 w-20" />)
    const el = container.querySelector('[data-slot="skeleton"]')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('h-4')
    expect(el).toHaveClass('w-20')
    expect(el).toHaveClass('bg-muted')
    expect(el).toHaveClass('after:animate-shimmer')
  })

  it('renders PageHeaderSkeleton with title and description', () => {
    const { container } = render(<PageHeaderSkeleton hasAction />)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThanOrEqual(2)
  })

  it('renders PostSkeleton with framed and unframed variants', () => {
    const { container: framedContainer } = render(
      <PostSkeleton framed={true} hasMedia />
    )
    expect(framedContainer.querySelector('.rounded-2xl')).toBeInTheDocument()

    const { container: unframedContainer } = render(
      <PostSkeleton framed={false} />
    )
    expect(
      unframedContainer.querySelector('.rounded-2xl')
    ).not.toBeInTheDocument()
  })

  it('renders ComposerSkeleton', () => {
    const { container } = render(<ComposerSkeleton />)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(4)
  })

  it('renders UserRowSkeleton', () => {
    const { container } = render(<UserRowSkeleton />)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThanOrEqual(3)
  })

  it('renders ProfileHeaderSkeleton', () => {
    const { container } = render(<ProfileHeaderSkeleton />)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(6)
  })

  it('renders NotificationRowSkeleton', () => {
    const { container } = render(<NotificationRowSkeleton />)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThanOrEqual(4)
  })
})
