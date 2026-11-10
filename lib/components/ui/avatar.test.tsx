/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Avatar, AvatarFallback } from './avatar'

describe('Avatar', () => {
  it('is a size container so the initials can follow its diameter, and has an inner hairline over the image', () => {
    const { container } = render(
      <Avatar className="size-20">
        <AvatarFallback>T</AvatarFallback>
      </Avatar>
    )
    const root = container.querySelector('[data-slot="avatar"]')
    expect(root).toHaveClass(
      '@container',
      'size-20',
      'rounded-full',
      'after:pointer-events-none',
      'after:absolute',
      'after:inset-0',
      'after:rounded-full',
      'after:shadow-[inset_0_0_0_1px_var(--border)]'
    )
    expect(root).not.toHaveClass('size-8')
  })

  it('scales the fallback initials with the container, about 0.42 x its width', () => {
    render(
      <Avatar>
        <AvatarFallback>T</AvatarFallback>
      </Avatar>
    )
    const fallback = screen.getByText('T')
    expect(fallback).toHaveClass('text-[42cqw]', 'leading-none')
    expect(fallback).toHaveClass('bg-muted', 'rounded-full')
  })

  it('keeps an explicit text size set by a call site', () => {
    render(
      <Avatar>
        <AvatarFallback className="text-xs">T</AvatarFallback>
      </Avatar>
    )
    const fallback = screen.getByText('T')
    expect(fallback).toHaveClass('text-xs')
    expect(fallback).not.toHaveClass('text-[42cqw]')
  })
})
