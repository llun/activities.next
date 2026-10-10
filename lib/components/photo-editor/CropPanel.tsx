'use client'

import { FlipHorizontal2, RotateCcw } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Slider } from '@/lib/components/ui/slider'
import {
  aspectCrop,
  clampCropToImage,
  flipGeometryHorizontal,
  getOrientedSize,
  getRecipeOutputSize,
  rotateGeometry90
} from '@/lib/services/medias/edit/geometry'
import {
  type Aspect,
  type CropRect,
  type Geometry,
  NEUTRAL_RECIPE
} from '@/lib/services/medias/edit/recipe'

import { PillGroup } from './PillGroup'
import { getAspectRatio } from './cropMath'
import type { EditorControls } from './editorControls'
import { formatStraighten, formatStraightenSpoken } from './editorFormat'
import { geometryChanged } from './editorRecipe'

const ASPECTS: ReadonlyArray<{ value: Aspect; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: 'free', label: 'Free' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '3:2', label: '3:2' },
  { value: '16:9', label: '16:9' }
]

/** Aspects with a portrait and a landscape form. */
const hasOrientation = (aspect: Aspect) =>
  aspect === '4:5' || aspect === '3:2' || aspect === '16:9'

const sameCrop = (a: CropRect, b: CropRect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

const withPortrait = (geometry: Geometry, portrait: boolean): Geometry => {
  const { aspectPortrait: _previous, ...rest } = geometry
  return portrait ? { ...rest, aspectPortrait: true } : rest
}

/**
 * The Crop tab: aspect presets, straighten, rotate, flip, reset, and the
 * output size. On a phone (`compact`) it replaces the chip area.
 */
export const CropPanel = ({
  controls,
  compact = false
}: {
  controls: EditorControls
  compact?: boolean
}) => {
  const { recipe, source, disabled } = controls
  const geometry = recipe.geometry
  const oriented = getOrientedSize(source, geometry.rotate90)
  const output = getRecipeOutputSize(source, recipe)
  const portrait = Boolean(geometry.aspectPortrait)
  // The button offers the other orientation than the crop has now.
  const ratio = getAspectRatio(geometry.aspect, portrait, oriented)
  const isLandscape = (ratio ?? 1) >= 1

  const applyAspect = (aspect: Aspect, nextPortrait: boolean) => {
    const base = withPortrait({ ...geometry, aspect }, nextPortrait)
    controls.onGeometryChange({
      ...base,
      crop: aspectCrop(
        aspect,
        nextPortrait,
        oriented,
        geometry.crop,
        geometry.straighten
      )
    })
  }

  const chooseAspect = (aspect: string) => {
    const next = aspect as Aspect
    if (next === geometry.aspect) {
      // Choosing the active ratio again turns it.
      if (hasOrientation(next)) applyAspect(next, !portrait)
      return
    }
    applyAspect(next, false)
  }

  // Straightening shrinks the crop to stay inside the rotated image. The crop
  // the user chose is kept, so turning back toward 0° grows it back instead of
  // leaving it shrunk. A crop changed any other way (drag, undo) is the new
  // base.
  const straightenBase = useRef<{ chosen: CropRect; clamped: CropRect } | null>(
    null
  )
  const straighten = (value: number) => {
    const memo = straightenBase.current
    const base =
      memo && sameCrop(memo.clamped, geometry.crop)
        ? memo.chosen
        : geometry.crop
    const clamped = clampCropToImage(base, value, oriented)
    straightenBase.current = { chosen: base, clamped }
    controls.onGeometryChange(
      { ...geometry, straighten: value, crop: clamped },
      'straighten'
    )
  }

  const straightenRow = (
    <div
      className="space-y-1"
      onPointerDownCapture={() => controls.onGestureStart('straighten')}
    >
      <div className="flex items-baseline justify-between text-sm">
        <span>Straighten</span>
        <span
          className={
            geometry.straighten !== 0
              ? 'font-semibold text-primary-text tabular-nums'
              : 'text-muted-foreground tabular-nums'
          }
        >
          {formatStraighten(geometry.straighten)}
        </span>
      </div>
      <Slider
        label="Straighten"
        value={geometry.straighten}
        min={-45}
        max={45}
        step={0.1}
        bipolar
        disabled={disabled}
        formatValue={formatStraightenSpoken}
        onValueChange={straighten}
        onValueCommit={controls.onGestureEnd}
      />
    </div>
  )

  const aspectRow = (
    <div className="space-y-2">
      <PillGroup
        aria-label="Aspect ratio"
        items={ASPECTS}
        value={geometry.aspect}
        onValueChange={chooseAspect}
        disabled={disabled}
      />
      {hasOrientation(geometry.aspect) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-2 text-xs max-md:min-h-10"
          disabled={disabled}
          onClick={() => applyAspect(geometry.aspect, !portrait)}
        >
          {isLandscape ? 'Portrait' : 'Landscape'}
        </Button>
      ) : null}
    </div>
  )

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="max-md:min-h-10"
        disabled={disabled}
        onClick={() => controls.onGeometryChange(rotateGeometry90(geometry))}
      >
        <RotateCcw aria-hidden="true" />
        Rotate 90°
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="max-md:min-h-10"
        disabled={disabled}
        onClick={() =>
          controls.onGeometryChange(flipGeometryHorizontal(geometry))
        }
      >
        <FlipHorizontal2 aria-hidden="true" />
        Flip
      </Button>
      {geometryChanged(geometry) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="max-md:min-h-10"
          disabled={disabled}
          onClick={() => controls.onGeometryChange(NEUTRAL_RECIPE.geometry)}
        >
          Reset crop
        </Button>
      ) : null}
    </div>
  )

  const outputLine = (
    <p className="text-xs text-muted-foreground">
      {output.width.toLocaleString()} × {output.height.toLocaleString()} px from{' '}
      {source.width.toLocaleString()} × {source.height.toLocaleString()}
    </p>
  )

  return (
    <div className={compact ? 'space-y-3 px-3 py-3' : 'space-y-5 p-4'}>
      {aspectRow}
      {straightenRow}
      {actions}
      {outputLine}
    </div>
  )
}
