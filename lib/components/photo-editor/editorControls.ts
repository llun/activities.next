import type { Size } from '@/lib/services/medias/edit/geometry'
import type {
  AdjustmentKey,
  Geometry,
  Recipe
} from '@/lib/services/medias/edit/recipe'

import type { ControlGroup } from './adjustmentControls'

/** What the Adjust and Crop panels (desktop and phone) read and change. */
export interface EditorControls {
  recipe: Recipe
  /** Pixel size of the source, for the crop maths and the output line. */
  source: Size
  /** True while saving: nothing can be changed. */
  disabled: boolean
  onAdjust: (key: AdjustmentKey, value: number) => void
  onGestureStart: (key: string) => void
  onGestureEnd: () => void
  onResetGroups: (groups: ControlGroup[]) => void
  onAuto: () => void
  /** "5 changes", "Looks good already", or null. */
  autoStatus: string | null
  onGeometryChange: (geometry: Geometry, coalesceKey?: string) => void
}
