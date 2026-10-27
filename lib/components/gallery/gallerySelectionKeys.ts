import { pluralize } from './galleryCategories'

export interface RangeSelectionInput {
  /** Display order (grouped, flattened). */
  order: readonly string[]
  /** Inclusive ends, either direction. */
  anchorId: string
  targetId: string
  /** The anchor's resulting state after its own toggle. */
  select: boolean
  selected: ReadonlySet<string>
  /** In-album / not pickable. */
  blocked: ReadonlySet<string>
  /** Infinity when there is no capacity. */
  room: number
}

export interface RangeSelectionResult {
  added: string[]
  removed: string[]
  hitRoom: boolean
}

/**
 * The ids between anchor and target in `order` (inclusive). `select` true adds
 * every id that is not selected and not blocked, in order, stopping when
 * `added.length === room` (`hitRoom` true if more remained); false removes
 * every selected id in the range (blocked ignored). The anchor is unchanged by
 * a range operation. An id missing from `order` is a no-op.
 */
export const applyRangeSelection = (
  input: RangeSelectionInput
): RangeSelectionResult => {
  const anchorIndex = input.order.indexOf(input.anchorId)
  const targetIndex = input.order.indexOf(input.targetId)
  if (anchorIndex === -1 || targetIndex === -1) {
    return { added: [], removed: [], hitRoom: false }
  }
  const [from, to] =
    anchorIndex < targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex]
  const rangeIds = input.order.slice(from, to + 1)
  if (!input.select) {
    return {
      added: [],
      removed: rangeIds.filter((id) => input.selected.has(id)),
      hitRoom: false
    }
  }
  const added: string[] = []
  let hitRoom = false
  for (const id of rangeIds) {
    if (input.selected.has(id) || input.blocked.has(id)) continue
    if (added.length >= input.room) {
      hitRoom = true
      break
    }
    added.push(id)
  }
  return { added, removed: [], hitRoom }
}

/**
 * "Selected 12 photos" / "Deselected 5 photos" / "Selected 3 photos, the
 * album is full" / "Nothing to change".
 */
export const describeRangeResult = (result: RangeSelectionResult): string => {
  if (result.added.length > 0) {
    return `Selected ${pluralize(result.added.length, 'photo')}${
      result.hitRoom ? ', the album is full' : ''
    }`
  }
  if (result.removed.length > 0) {
    return `Deselected ${pluralize(result.removed.length, 'photo')}`
  }
  return 'Nothing to change'
}

/**
 * Next flat index for ArrowLeft/Right (±1), ArrowUp/Down (±columns),
 * Home/End; null when the key is not handled; clamps to [0, count-1]. When
 * `groupSizes` is given, vertical movement stays within each group's grid and
 * crosses into the adjacent group's first or last row at the same column.
 */
export const moveGridFocus = (
  index: number,
  key: string,
  count: number,
  columns: number,
  groupSizes?: readonly number[]
): number | null => {
  if (count <= 0) return null
  const clamp = (value: number) => Math.min(Math.max(value, 0), count - 1)
  const columnCount = Math.max(columns, 1)
  if ((key === 'ArrowUp' || key === 'ArrowDown') && groupSizes !== undefined) {
    const sizes = groupSizes.filter((size) => size > 0)
    if (
      sizes.reduce((sum, size) => sum + size, 0) === count &&
      sizes.every(Number.isInteger)
    ) {
      let start = 0
      const currentGroup = sizes.findIndex((size) => {
        const contains = index >= start && index < start + size
        start += size
        return contains
      })
      if (currentGroup !== -1) {
        const currentSize = sizes[currentGroup]
        const groupStart = sizes
          .slice(0, currentGroup)
          .reduce((sum, size) => sum + size, 0)
        const localIndex = index - groupStart
        const column = localIndex % columnCount
        const row = Math.floor(localIndex / columnCount)
        const direction = key === 'ArrowDown' ? 1 : -1
        const targetRow = row + direction
        const rowCount = Math.ceil(currentSize / columnCount)
        if (targetRow >= 0 && targetRow < rowCount) {
          return (
            groupStart +
            Math.min(targetRow * columnCount + column, currentSize - 1)
          )
        }

        const targetGroup = currentGroup + direction
        if (targetGroup < 0 || targetGroup >= sizes.length) {
          return (
            groupStart +
            Math.min(
              Math.max(localIndex + direction * columnCount, 0),
              currentSize - 1
            )
          )
        }
        const targetSize = sizes[targetGroup]
        const targetGroupStart =
          groupStart + (direction > 0 ? currentSize : -targetSize)
        const edgeRow =
          direction > 0 ? 0 : Math.ceil(targetSize / columnCount) - 1
        return (
          targetGroupStart +
          Math.min(edgeRow * columnCount + column, targetSize - 1)
        )
      }
    }
  }
  switch (key) {
    case 'ArrowLeft':
      return clamp(index - 1)
    case 'ArrowRight':
      return clamp(index + 1)
    case 'ArrowUp':
      return clamp(index - columnCount)
    case 'ArrowDown':
      return clamp(index + columnCount)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * Rendered column count of a CSS grid element:
 * `getComputedStyle(el).gridTemplateColumns` split on spaces; at least 1.
 */
export const getGridColumnCount = (grid: Element): number => {
  const template = getComputedStyle(grid).gridTemplateColumns
  const count = template.trim().split(/\s+/).filter(Boolean).length
  return Math.max(count, 1)
}
