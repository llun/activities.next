/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge } from './badge'

describe('Badge', () => {
  it('shows its label as a span and is gray unless told otherwise', () => {
    render(<Badge>App</Badge>)
    const badge = screen.getByText('App')
    expect(badge.tagName).toBe('SPAN')
    expect(badge).toHaveAttribute('data-slot', 'badge')
    expect(badge).toHaveAttribute('data-tone', 'gray')
  })

  it.each([
    'gray',
    'primary',
    'success',
    'warning',
    'info',
    'destructive'
  ] as const)('names the %s tone it was asked for', (tone) => {
    render(<Badge tone={tone}>Label</Badge>)
    expect(screen.getByText('Label')).toHaveAttribute('data-tone', tone)
  })

  it('passes other attributes through to the span', () => {
    render(
      <Badge tone="info" title="Signed in with this" className="shrink-0">
        Sign-in
      </Badge>
    )
    expect(screen.getByText('Sign-in')).toHaveAttribute(
      'title',
      'Signed in with this'
    )
  })
})
