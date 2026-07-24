'use client'

import { BarChart3, Clock, Plus, X } from 'lucide-react'
import { FC, useEffect, useMemo } from 'react'

import { useInstanceLimits } from '@/lib/components/instance-limits'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import {
  DURATIONS,
  Duration,
  SecondsToDurationText
} from '@/lib/services/statuses/pollDurations'

export interface Choice {
  key: number
  text: string
}

// Mastodon requires at least two choices; the upper bound is the instance's
// resolved polls.maxOptions.
const MIN_CHOICES = 2

interface Props {
  show: boolean
  choices: Choice[]
  durationInSeconds: Duration
  pollType: 'oneOf' | 'anyOf'
  onAddChoice: () => void
  onRemoveChoice: (index: number) => void
  onChooseDuration: (durationInSeconds: Duration) => void
  onPollTypeChange: (pollType: 'oneOf' | 'anyOf') => void
  onRemove: () => void
}

export const PollChoices: FC<Props> = ({
  show,
  choices,
  durationInSeconds,
  pollType,
  onAddChoice,
  onRemoveChoice,
  onChooseDuration,
  onPollTypeChange,
  onRemove
}) => {
  // The instance's configured poll limits, so the editor can only build a poll
  // the create endpoint will accept (it enforces the same resolved values).
  const {
    maxPollOptions,
    maxPollOptionCharacters,
    minPollExpirationSeconds,
    maxPollExpirationSeconds
  } = useInstanceLimits()

  // Only offer durations inside the instance's configured expiry range. If the
  // range excludes every duration we know how to label (an admin can configure
  // that through the API), keep the full list rather than rendering a dead
  // picker and let the create endpoint be the one to object.
  const durations = useMemo(() => {
    const inRange = DURATIONS.filter(
      (seconds) =>
        seconds >= minPollExpirationSeconds &&
        seconds <= maxPollExpirationSeconds
    )
    return inRange.length > 0 ? inRange : DURATIONS
  }, [minPollExpirationSeconds, maxPollExpirationSeconds])

  // A duration selected before the range changed (or the built-in default) can
  // fall outside it; move to the nearest offered one so the draft always
  // carries a value the endpoint accepts, and so a range bounded from above
  // does not silently collapse the selection to the shortest option.
  useEffect(() => {
    if (durations.includes(durationInSeconds)) return
    const nearest = durations.reduce((closest, seconds) =>
      Math.abs(seconds - durationInSeconds) <
      Math.abs(closest - durationInSeconds)
        ? seconds
        : closest
    )
    onChooseDuration(nearest)
  }, [durations, durationInSeconds, onChooseDuration])

  if (!show) return null

  return (
    <div className="mt-3 rounded-lg border bg-background p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <BarChart3 className="size-3" /> Poll
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Remove poll"
          onClick={onRemove}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {choices.map((choice, index) => (
          <div key={choice.key} className="flex flex-row items-center gap-2">
            <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <Input
              type="text"
              name="poll[]"
              placeholder={`Choice ${index + 1}`}
              maxLength={maxPollOptionCharacters}
              defaultValue={choice.text}
              onChange={(e) => {
                choice.text = e.currentTarget.value
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={choices.length <= MIN_CHOICES}
              aria-label={`Remove choice ${index + 1}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onRemoveChoice(index)}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      {choices.length < maxPollOptions ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-7 mt-2 gap-1.5 text-primary hover:bg-primary/10 hover:text-primary"
          onClick={() => onAddChoice()}
        >
          <Plus className="size-3.5" /> Add choice
        </Button>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
        <label
          htmlFor="poll-duration"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Clock className="size-3.5" />
          <span>Ends in</span>
          <Select
            id="poll-duration"
            value={durationInSeconds}
            onChange={(e) =>
              onChooseDuration(parseInt(e.target.value, 10) as Duration)
            }
            className="h-8 w-auto px-2 text-xs font-medium text-foreground md:text-xs"
          >
            {durations.map((duration) => (
              <option key={duration} value={duration}>
                {SecondsToDurationText[duration]}
              </option>
            ))}
          </Select>
        </label>

        <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Switch
            id="poll-multiple"
            checked={pollType === 'anyOf'}
            onCheckedChange={(checked) =>
              onPollTypeChange(checked ? 'anyOf' : 'oneOf')
            }
          />
          <label htmlFor="poll-multiple" className="cursor-pointer">
            Allow multiple choices
          </label>
        </div>
      </div>
    </div>
  )
}
