/**
 * @vitest-environment jsdom
 */
import { fireEvent, renderHook } from '@testing-library/react'

import { useEditorShortcuts } from './useEditorShortcuts'

const handlers = (active: boolean) => ({
  active,
  undo: vi.fn(),
  redo: vi.fn(),
  save: vi.fn(),
  setComparing: vi.fn()
})

describe('useEditorShortcuts', () => {
  it('saves and undoes while active', () => {
    const h = handlers(true)
    renderHook(() => useEditorShortcuts(true, h))
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.undo).toHaveBeenCalledTimes(1)
  })

  it('keeps Ctrl+S from the browser while loading or saving, and does nothing', () => {
    const h = handlers(false)
    renderHook(() => useEditorShortcuts(true, h))
    const notPrevented = fireEvent.keyDown(document.body, {
      key: 's',
      ctrlKey: true
    })
    expect(notPrevented).toBe(false)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(h.save).not.toHaveBeenCalled()
    expect(h.undo).not.toHaveBeenCalled()
  })
})
