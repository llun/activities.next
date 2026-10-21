/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { WifiOff } from 'lucide-react'

import { Alert, type AlertTone } from './Alert'

describe('Alert', () => {
  it('is an error alert by default', () => {
    render(<Alert title="Could not load">Try again.</Alert>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-tone', 'error')
    expect(alert).toHaveTextContent('Could not load')
    expect(alert).toHaveTextContent('Try again.')
  })

  it.each([
    ['error', 'alert'],
    ['warning', 'alert'],
    ['success', 'status'],
    ['info', 'status']
  ] as const)(
    'announces the %s tone as a %s with a hidden icon',
    (tone: AlertTone, role) => {
      const { container } = render(<Alert tone={tone} title="Heads up" />)
      expect(screen.getByRole(role)).toHaveAttribute('data-tone', tone)
      expect(container.querySelector('svg')).toHaveAttribute(
        'aria-hidden',
        'true'
      )
    }
  )

  it('replaces the tone icon with `icon`, keeping the tone colour and a hidden icon', () => {
    const { container } = render(
      <Alert tone="info" icon={WifiOff} title="You're offline." />
    )
    const icons = container.querySelectorAll('svg')
    expect(icons).toHaveLength(1)
    expect(icons[0]).toHaveClass('lucide-wifi-off', 'text-info-text')
    expect(icons[0]).not.toHaveClass('lucide-info')
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true')
  })

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

  it('drops the live role for a row that is just part of the page', () => {
    render(
      <Alert tone="warning" live={false} title="Two-factor is off">
        Add an authenticator app.
      </Alert>
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('Two-factor is off')).toBeVisible()
  })

  it('has no action row without either', () => {
    render(<Alert title="Saved" tone="success" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it.each([
    ['error', 'destructive'],
    ['warning', 'warning'],
    ['success', 'success'],
    ['info', 'info']
  ] as const)(
    'fills the %s tone with an opaque tinted surface card',
    (tone: AlertTone, color) => {
      render(<Alert tone={tone} title="Heads up" />)
      const card = screen.getByRole(
        tone === 'error' || tone === 'warning' ? 'alert' : 'status'
      )
      expect(card).toHaveClass(`bg-${color}-surface`, `border-${color}/25`)
      expect(card).toHaveClass(`border-l-${color}`, 'border-l-4', 'rounded-lg')
    }
  )
})
