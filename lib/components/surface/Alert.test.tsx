/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { Alert, type AlertTone } from './Alert'

describe('Alert', () => {
  it('is an error alert by default, with the destructive rule', () => {
    render(<Alert title="Could not load">Try again.</Alert>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveClass('border-l-4', 'border-l-destructive')
    expect(alert).toHaveTextContent('Could not load')
    expect(alert).toHaveTextContent('Try again.')
  })

  it.each([
    ['error', 'alert', 'border-l-destructive', 'text-destructive-text'],
    ['warning', 'alert', 'border-l-warning', 'text-warning-text'],
    ['success', 'status', 'border-l-success', 'text-success-text'],
    ['info', 'status', 'border-l-info', 'text-info-text']
  ] as const)(
    'draws the %s tone as a %s with its rule and icon colour',
    (tone: AlertTone, role, rule, iconColour) => {
      const { container } = render(<Alert tone={tone} title="Heads up" />)
      const root = screen.getByRole(role)
      expect(root).toHaveClass(rule)
      expect(root).toHaveAttribute('data-tone', tone)
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass(iconColour)
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  )

  it('offers Retry when given onRetry', () => {
    const onRetry = vi.fn()
    render(<Alert title="Could not load" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('prefers a custom action over Retry', () => {
    render(
      <Alert
        title="Could not load"
        onRetry={vi.fn()}
        action={<a href="/help">Get help</a>}
      />
    )
    expect(screen.getByRole('link', { name: 'Get help' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('has no action row without either', () => {
    render(<Alert title="Saved" tone="success" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
