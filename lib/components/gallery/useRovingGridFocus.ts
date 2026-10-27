'use client'

import { useCallback, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { getGridColumnCount, moveGridFocus } from './gallerySelectionKeys'

/**
 * One roving tab stop for a grid of tiles. The host renders each tile with
 * `tabIndex={getTabIndex(index)}`, `data-grid-index={index}` and
 * `onFocus={() => onFocusTile(index)}`, and puts `onKeyDown` on the grid
 * container (which carries `data-grid`).
 */
export const useRovingGridFocus = ({
  enabled,
  count,
  groupSizes
}: {
  enabled: boolean
  count: number
  /** Tile counts for the grid sections, in rendered order. */
  groupSizes?: readonly number[]
}) => {
  const [index, setIndex] = useState(0)
  // Clamped when count shrinks; 0 at start.
  const activeIndex = count > 0 ? Math.min(index, count - 1) : 0

  // Undefined when !enabled: the tiles keep their native tab order.
  const getTabIndex = useCallback(
    (tileIndex: number): 0 | -1 | undefined =>
      enabled ? (tileIndex === activeIndex ? 0 : -1) : undefined,
    [enabled, activeIndex]
  )

  const onFocusTile = useCallback((tileIndex: number) => {
    setIndex(tileIndex)
  }, [])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!enabled) return
      // Alt/Ctrl/Cmd combinations belong to the browser and the OS (Back,
      // jump to address bar), so they neither move tile focus nor swallow
      // the key. Shift is fine: Shift+Space is a range toggle.
      if (event.altKey || event.metaKey || event.ctrlKey) return
      const target = event.target
      const tile =
        target instanceof Element ? target.closest('[data-grid-index]') : null
      if (!tile) return
      const tileIndex = Number(tile.getAttribute('data-grid-index'))
      if (!Number.isInteger(tileIndex)) return
      const grid = tile.closest('[data-grid]')
      const columns = grid ? getGridColumnCount(grid) : 1
      const next = moveGridFocus(
        tileIndex,
        event.key,
        count,
        columns,
        groupSizes
      )
      if (next === null) return
      setIndex(next)
      const nextTile = event.currentTarget.querySelector(
        `[data-grid-index="${next}"]`
      )
      if (nextTile instanceof HTMLElement) {
        nextTile.focus()
      }
      event.preventDefault()
    },
    [enabled, count, groupSizes]
  )

  return { activeIndex, getTabIndex, onFocusTile, onKeyDown }
}
