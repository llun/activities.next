/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const Harness = ({ dirty }: { dirty: boolean }) => {
  const guard = useUnsavedChangesGuard(dirty)
  return (
    <div>
      <a href="/elsewhere?x=1#top">In app</a>
      <a href="https://other.example/page">Outside</a>
      <a href="#section">Same page</a>
      <a href="/elsewhere" target="_blank">
        New tab
      </a>
      <a href="/file.zip" download>
        Download
      </a>
      <button type="button" onClick={guard.allowNavigation}>
        Allow
      </button>
      <button type="button" onClick={guard.keepEditing}>
        Keep
      </button>
      <button type="button" onClick={guard.discard}>
        Discard
      </button>
      <output>{guard.pendingHref ?? 'none'}</output>
    </div>
  )
}

const unload = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('holds back an in-app link click while dirty and remembers where it led', () => {
    render(<Harness dirty />)

    const notPrevented = fireEvent.click(
      screen.getByRole('link', { name: 'In app' })
    )

    expect(notPrevented).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent('/elsewhere?x=1#top')
  })

  it('follows the held-back link on discard, once', () => {
    render(<Harness dirty />)
    fireEvent.click(screen.getByRole('link', { name: 'In app' }))

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(push).toHaveBeenCalledWith('/elsewhere?x=1#top')
    expect(screen.getByRole('status')).toHaveTextContent('none')
  })

  it('forgets the link on keep editing', () => {
    render(<Harness dirty />)
    fireEvent.click(screen.getByRole('link', { name: 'In app' }))

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))

    expect(screen.getByRole('status')).toHaveTextContent('none')
    expect(push).not.toHaveBeenCalled()
  })

  it('leaves clicks alone when clean', () => {
    render(<Harness dirty={false} />)

    expect(fireEvent.click(screen.getByRole('link', { name: 'In app' }))).toBe(
      true
    )
    expect(unload()).toBe(false)
  })

  it('leaves outside links, same-page links, new tabs and downloads alone', () => {
    render(<Harness dirty />)

    for (const name of ['Outside', 'Same page', 'New tab', 'Download']) {
      expect(fireEvent.click(screen.getByRole('link', { name }))).toBe(true)
    }
    expect(screen.getByRole('status')).toHaveTextContent('none')
  })

  it('leaves modified clicks alone', () => {
    render(<Harness dirty />)
    const link = screen.getByRole('link', { name: 'In app' })

    expect(fireEvent.click(link, { shiftKey: true })).toBe(true)
    expect(fireEvent.click(link, { altKey: true })).toBe(true)
    expect(fireEvent.click(link, { button: 2 })).toBe(true)
  })

  it('asks on beforeunload while dirty only', () => {
    const { rerender } = render(<Harness dirty />)
    expect(unload()).toBe(true)

    rerender(<Harness dirty={false} />)
    expect(unload()).toBe(false)
  })

  it('stands down for good once navigation is allowed', () => {
    render(<Harness dirty />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    expect(unload()).toBe(false)
    expect(fireEvent.click(screen.getByRole('link', { name: 'In app' }))).toBe(
      true
    )
  })

  it('removes its listeners on unmount', () => {
    const { unmount } = render(<Harness dirty />)
    unmount()

    expect(unload()).toBe(false)
  })
})
