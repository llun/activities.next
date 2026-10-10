'use client'

import { useEffect, useRef } from 'react'

interface Handlers {
  /**
   * False while loading, saving or behind a prompt: the shortcuts do nothing,
   * but Ctrl/Cmd+S is still kept from opening the browser's "Save page as".
   */
  active: boolean
  undo: () => void
  redo: () => void
  save: () => void
  setComparing: (comparing: boolean) => void
}

const isTextInput = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return !['range', 'checkbox', 'radio', 'button'].includes(type)
}

/**
 * Editor shortcuts while `enabled` (and `handlers.active`): Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and
 * Ctrl+Y redo, hold `\` to compare, Ctrl/Cmd+S save. Escape is handled by the
 * dialog (`onEscapeKeyDown`) so Radix does not close it first. Ignored while
 * focus is in a text input.
 */
export const useEditorShortcuts = (enabled: boolean, handlers: Handlers) => {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    if (!enabled) return
    let comparing = false

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInput(event.target)) return
      const modifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const { active } = latest.current
      if (modifier && key === 's') {
        event.preventDefault()
        if (active) latest.current.save()
      } else if (!active) {
        return
      } else if (modifier && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) latest.current.redo()
        else latest.current.undo()
      } else if (event.ctrlKey && !event.metaKey && key === 'y') {
        event.preventDefault()
        latest.current.redo()
      } else if (event.key === '\\' && !modifier && !comparing) {
        comparing = true
        latest.current.setComparing(true)
      }
    }
    const stopComparing = () => {
      if (!comparing) return
      comparing = false
      latest.current.setComparing(false)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === '\\') stopComparing()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', stopComparing)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', stopComparing)
      stopComparing()
    }
  }, [enabled])
}
