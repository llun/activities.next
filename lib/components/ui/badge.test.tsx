/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge } from './badge'

describe('Badge', () => {
  it('uses the orange TEXT token for the primary tone, with a stronger dark fill', () => {
    render(<Badge tone="primary">This device</Badge>)
    const badge = screen.getByText('This device')
    expect(badge).toHaveClass('bg-primary/10', 'text-primary-text')
    expect(badge).not.toHaveClass('text-primary')
    expect(badge.className).toContain('dark:bg-[#FA802E]/16')
  })

  it('uses the destructive TEXT token for the destructive tone, with a visible dark fill', () => {
    render(<Badge tone="destructive">Expiring soon</Badge>)
    const badge = screen.getByText('Expiring soon')
    expect(badge).toHaveClass('text-destructive-text')
    expect(badge.className).toContain('dark:bg-[#DF3A3A]/16')
  })

  it('gives the success tone a dark green variant', () => {
    render(<Badge tone="success">Retried</Badge>)
    const badge = screen.getByText('Retried')
    expect(badge).toHaveClass('bg-green-100', 'text-green-800')
    expect(badge.className).toContain('dark:bg-[#163B24]')
    expect(badge.className).toContain('dark:text-[#69D390]')
  })

  it('gives the blue (Sign-in) tone a dark teal variant', () => {
    render(<Badge tone="blue">Sign-in</Badge>)
    const badge = screen.getByText('Sign-in')
    expect(badge).toHaveClass('bg-blue-100', 'text-blue-800')
    expect(badge.className).toContain('dark:bg-[#00BCFF]/16')
    expect(badge).toHaveClass('dark:text-foreground')
  })

  it('gives the gray tone the design dark fill and a lighter label', () => {
    render(<Badge tone="gray">App</Badge>)
    const badge = screen.getByText('App')
    expect(badge).toHaveClass('bg-muted', 'text-muted-foreground')
    expect(badge.className).toContain('dark:bg-[#383838]')
    expect(badge.className).toContain('dark:text-[#C2C2C2]')
  })
})
