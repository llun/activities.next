/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'

import { focusStartCandidate } from './focusStartCandidate'

const mount = (disabled = false) => {
  const button = document.createElement('button')
  button.disabled = disabled
  document.body.appendChild(button)
  return button
}

describe('focusStartCandidate', () => {
  it('focuses the first candidate in rule order', () => {
    const startImport = mount()
    const retry = mount()
    const picker = mount()

    focusStartCandidate([startImport, retry, picker])

    expect(document.activeElement).toBe(startImport)
  })

  it('skips a disabled candidate and focuses the next one', () => {
    const startImport = mount(true)
    const retry = mount()
    const picker = mount()

    focusStartCandidate([startImport, retry, picker])

    expect(document.activeElement).toBe(retry)
  })

  it('skips an unmounted candidate and focuses the next one', () => {
    // A detached node, the way a ref can outlive the control it pointed at.
    const detached = document.createElement('button')
    const retry = mount()
    const picker = mount()

    focusStartCandidate([detached, retry, picker])

    expect(document.activeElement).toBe(retry)
  })

  it('falls back to the file picker', () => {
    const picker = mount()

    focusStartCandidate([null, undefined, picker])

    expect(document.activeElement).toBe(picker)
  })

  it('focuses nothing when no candidate can take the focus', () => {
    // The DOM is shared with the tests above, so the focus they left
    // behind is dropped before the call is checked.
    ;(document.activeElement as HTMLElement | null)?.blur()
    const disabled = mount(true)
    const detached = document.createElement('button')

    focusStartCandidate([disabled, detached, null])

    expect(document.activeElement).toBe(document.body)
  })
})
