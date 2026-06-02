'use client'

import { BarChart3, Clock, Plus, X } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'

export const DEFAULT_DURATION = 86_400

export const SecondsToDurationText = {
  300: '5 minutes',
  1_800: '30 minutes',
  3_600: '1 hour',
  21_600: '6 hours',
  43_200: '12 hours',
  86_400: '1 day',
  259_200: '3 days',
  604_800: '7 days'
}

export type Duration = keyof typeof SecondsToDurationText

export interface Choice {
  key: number
  text: string
}

const MAX_CHOICES = 5

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
              defaultValue={choice.text}
              onChange={(e) => {
                choice.text = e.currentTarget.value
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={choices.length <= 2}
              aria-label={`Remove choice ${index + 1}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onRemoveChoice(index)}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      {choices.length < MAX_CHOICES ? (
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
            {Object.keys(SecondsToDurationText).map((duration) => (
              <option key={duration} value={duration}>
                {SecondsToDurationText[parseInt(duration, 10) as Duration]}
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
