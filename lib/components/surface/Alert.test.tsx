/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

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

  it('keeps its tone and announcement when it sits flush as a frame row', () => {
    render(
      <Alert tone="warning" flush title="Heads up">
        Mind the gap.
      </Alert>
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-tone', 'warning')
    expect(alert).toHaveTextContent('Heads up')
    expect(alert).toHaveTextContent('Mind the gap.')
  })

  it('has no action row without either', () => {
    render(<Alert title="Saved" tone="success" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
