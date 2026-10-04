/**
 * Decides how the range picker is presented: an anchored popover when the
 * WHOLE panel fits, a bottom sheet otherwise. Pure, so the rule is testable
 * without a browser; `RangePicker` feeds it measurements.
 *
 * The rule follows the design annotation: the popover is 710 x 410, aligned to
 * the trigger's right edge and 8px below it, and needs a 32px safe margin
 * around it. Horizontally the room is measured from the trigger's right edge
 * back to the left edge of the main column (the content area beside the
 * navigation), so a tablet in portrait uses the sheet even though the viewport
 * is wider than the panel.
 */

/** Width of the three-column popover panel. */
export const POPOVER_WIDTH = 710
/** Height of the popover panel with no inline error showing. */
export const POPOVER_HEIGHT = 410
/** Space kept clear around the popover. */
export const SAFE_MARGIN = 32
/** Gap between the trigger and the popover. */
export const TRIGGER_OFFSET = 8

export interface BoxEdges {
  left: number
  right: number
  top: number
  bottom: number
}

export interface PresentationInput {
  viewport: { width: number; height: number }
  /** The trigger's rectangle in viewport coordinates. */
  trigger: BoxEdges
  /** Left edge of the main column; 0 when the trigger has no such container. */
  boundaryLeft?: number
  /** The panel's size in popover layout; the design size by default. */
  panel?: { width: number; height: number }
  margin?: number
}

export type PickerPresentation = 'popover' | 'sheet'

export const choosePresentation = ({
  viewport,
  trigger,
  boundaryLeft = 0,
  panel = { width: POPOVER_WIDTH, height: POPOVER_HEIGHT },
  margin = SAFE_MARGIN
}: PresentationInput): PickerPresentation => {
  const measured = [
    viewport.width,
    viewport.height,
    trigger.left,
    trigger.right,
    trigger.top,
    trigger.bottom,
    panel.width,
    panel.height
  ]
  if (!measured.every(Number.isFinite)) return 'sheet'
  // A trigger that has not been laid out (zero-size at the origin) cannot
  // anchor anything; the sheet needs no anchor.
  if (trigger.right === 0 && trigger.bottom === 0) return 'sheet'

  const fitsViewportWidth = viewport.width >= panel.width + 2 * margin
  const roomOnTheLeft = trigger.right - Math.max(0, boundaryLeft)
  const fitsHorizontally =
    fitsViewportWidth && roomOnTheLeft >= panel.width + margin

  const roomBelow = viewport.height - trigger.bottom - TRIGGER_OFFSET - margin
  const roomAbove = trigger.top - TRIGGER_OFFSET - margin
  const fitsVertically = roomBelow >= panel.height || roomAbove >= panel.height

  return fitsHorizontally && fitsVertically ? 'popover' : 'sheet'
}
