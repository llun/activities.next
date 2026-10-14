'use client'

import { RotateCcw, Sparkles } from 'lucide-react'
import { useRef } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import { Slider } from '@/lib/components/ui/slider'
import { cn } from '@/lib/utils'

import { PillGroup } from './PillGroup'
import type { EditorControls } from './editorControls'
import { ENHANCE_COPY } from './enhanceCopy'
import { DEFAULT_ENHANCE_STRENGTH, PRESETS, type PresetId } from './presets'
import { ENHANCE_STRENGTH_KEY } from './useAiEnhance'

const STYLE_ITEMS = PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.label
}))

/**
 * The Presets tab: instant client-side look presets (Natural, Vivid,
 * Dramatic, Warm, Cool, B&W), with a Strength slider and a Reset button.
 */
export const PresetsPanel = ({
  controls,
  compact = false
}: {
  controls: EditorControls
  compact?: boolean
}) => {
  const { ai, disabled } = controls
  const enhanceButton = useRef<HTMLButtonElement>(null)

  return (
    <div className={compact ? 'space-y-3 px-3 py-3' : 'space-y-5 p-4'}>
      {!ai.hasSuggestion ? (
        <p className="text-sm text-muted-foreground">{ENHANCE_COPY.intro}</p>
      ) : null}

      {ai.error ? <Alert title={ai.error} /> : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {ai.style !== null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-md:min-h-10"
            disabled={disabled}
            onClick={ai.resetStyle}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {ENHANCE_COPY.reset}
          </Button>
        ) : (
          <Button
            ref={enhanceButton}
            type="button"
            variant="pill"
            size="sm"
            className="max-md:min-h-10"
            disabled={disabled}
            onClick={ai.enhance}
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            {ai.hasSuggestion ? ENHANCE_COPY.again : ENHANCE_COPY.enhance}
          </Button>
        )}
        {ai.hasSuggestion && ai.model ? (
          <span className="min-w-0 text-xs break-words text-muted-foreground">
            {ENHANCE_COPY.suggestedBy(ai.model)}
          </span>
        ) : null}
      </div>

      <PillGroup
        aria-label={ENHANCE_COPY.style}
        compact={compact}
        items={STYLE_ITEMS}
        value={ai.style}
        disabled={disabled}
        onValueChange={(style) => ai.setStyle(style as PresetId)}
      />

      {ai.hasSuggestion ? (
        <>
          {/* Always rendered, so a screen reader hears it appear. */}
          <div
            role="status"
            className="text-xs text-muted-foreground empty:hidden"
          >
            {ai.style === null ? ENHANCE_COPY.notApplied : null}
          </div>

          <div
            className="space-y-1"
            onPointerDownCapture={() =>
              controls.onGestureStart(ENHANCE_STRENGTH_KEY)
            }
          >
            <div className="flex items-baseline justify-between text-sm">
              <span>{ENHANCE_COPY.strength}</span>
              <span
                className={cn(
                  'tabular-nums',
                  ai.strength !== DEFAULT_ENHANCE_STRENGTH
                    ? 'font-semibold text-primary-text'
                    : 'text-muted-foreground'
                )}
              >
                {ai.strength}
              </span>
            </div>
            <Slider
              label={ENHANCE_COPY.strength}
              value={ai.strength}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              defaultValue={DEFAULT_ENHANCE_STRENGTH}
              formatValue={(value) =>
                ai.style === null ? `${value}, not applied` : `${value}`
              }
              onValueChange={ai.setStrength}
              onValueCommit={() => {
                controls.onGestureEnd()
                ai.commitStrength()
              }}
            />
          </div>

          {ai.needsSubjectMask ? (
            <p className="text-xs text-muted-foreground">
              {ENHANCE_COPY.needSubject}
            </p>
          ) : null}
          {ai.needsBackgroundMask ? (
            <p className="text-xs text-muted-foreground">
              {ENHANCE_COPY.needBackground}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
