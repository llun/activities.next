'use client'

import { Loader2, Sparkles } from 'lucide-react'

import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import { Slider } from '@/lib/components/ui/slider'
import {
  ENHANCE_STYLES,
  type EnhanceStyle
} from '@/lib/services/medias/edit/enhanceSchema'
import { cn } from '@/lib/utils'

import { PillGroup } from './PillGroup'
import type { EditorControls } from './editorControls'
import { DEFAULT_ENHANCE_STRENGTH } from './enhanceApply'
import { ENHANCE_COPY, ENHANCE_STYLE_LABELS } from './enhanceCopy'
import { ENHANCE_STRENGTH_KEY } from './useAiEnhance'

const STYLE_ITEMS = ENHANCE_STYLES.map((style) => ({
  value: style,
  label: ENHANCE_STYLE_LABELS[style]
}))

/**
 * The AI tab: an Enhance button that sends a small preview to the server's
 * vision model, then a style (Natural, Vivid, Dramatic) and a Strength slider
 * over the suggestion. The editor renders no AI tab when enhance is not
 * available, so this never shows a "not set up" state. On a phone (`compact`)
 * it replaces the chip area.
 */
export const AiPanel = ({
  controls,
  compact = false
}: {
  controls: EditorControls
  compact?: boolean
}) => {
  const { ai, disabled } = controls
  const loading = ai.status === 'loading'

  return (
    <div className={compact ? 'space-y-3 px-3 py-3' : 'space-y-5 p-4'}>
      {ai.hasSuggestion ? null : (
        <p className="text-sm text-muted-foreground">{ENHANCE_COPY.intro}</p>
      )}

      {ai.error ? (
        <Alert
          title={ai.error}
          onRetry={loading || disabled ? undefined : ai.enhance}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="button"
          variant="pill"
          size="sm"
          className="max-md:min-h-10"
          disabled={disabled || loading}
          aria-busy={loading}
          onClick={ai.enhance}
        >
          {loading ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles aria-hidden="true" />
          )}
          {loading
            ? ENHANCE_COPY.enhancing
            : ai.hasSuggestion
              ? ENHANCE_COPY.again
              : ENHANCE_COPY.enhance}
        </Button>
        {ai.hasSuggestion && ai.model ? (
          <span className="min-w-0 text-xs break-words text-muted-foreground">
            {ENHANCE_COPY.suggestedBy(ai.model)}
          </span>
        ) : null}
      </div>

      {ai.hasSuggestion ? (
        <>
          <PillGroup
            aria-label={ENHANCE_COPY.style}
            compact={compact}
            items={STYLE_ITEMS}
            value={ai.style}
            disabled={disabled || loading}
            onValueChange={(style) => ai.setStyle(style as EnhanceStyle)}
          />

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
              disabled={disabled || loading}
              defaultValue={DEFAULT_ENHANCE_STRENGTH}
              formatValue={(value) => `${value}`}
              onValueChange={ai.setStrength}
              onValueCommit={controls.onGestureEnd}
            />
          </div>

          {ai.needsSubjectMask ? (
            <p className="text-xs text-muted-foreground">
              {ENHANCE_COPY.needSubject}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
