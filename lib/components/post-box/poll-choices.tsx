'use client'

import { XCircle } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { Input } from '@/lib/components/ui/input'

export const DEFAULT_DURATION = 21_600

export const SecondsToDurationText = {
  300: '5 Minutes',
  1_800: '30 Minutes',
  3_600: '1 Hour',
  21_600: '6 Hours',
  43_200: '12 Hours',
  86_400: '1 Day',
  259_200: '3 Days',
  604_800: '7 Days'
}

export type Duration = keyof typeof SecondsToDurationText

export interface Choice {
  key: number
  text: string
}

interface Props {
  show: boolean
  choices: Choice[]
  durationInSeconds: Duration
  pollType: 'oneOf' | 'anyOf'
  onAddChoice: () => void
  onRemoveChoice: (index: number) => void
  onChooseDuration: (durationInSeconds: Duration) => void
  onPollTypeChange: (pollType: 'oneOf' | 'anyOf') => void
}

export const PollChoices: FC<Props> = ({
  show,
  choices,
  durationInSeconds,
  pollType,
  onAddChoice,
  onRemoveChoice,
  onChooseDuration,
  onPollTypeChange
}) => {
  if (!show) return null

  return (
    <div className="mb-4 space-y-2">
      {choices.map((choice, index) => (
        <div key={choice.key} className="flex flex-row items-center gap-2">
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
            disabled={choices.length < 3}
            variant="link"
            onClick={() => onRemoveChoice(index)}
          >
            <XCircle className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-row items-center gap-2 pt-2">
        <div className="flex items-center space-x-2">
          <input
            className="peer h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2"
            type="checkbox"
            checked={pollType === 'anyOf'}
            id="flexCheckDefault"
            onChange={(e) =>
              onPollTypeChange(e.target.checked ? 'anyOf' : 'oneOf')
            }
          />
          <label
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            htmlFor="flexCheckDefault"
          >
            Multiple Choices
          </label>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary">
              {SecondsToDurationText[durationInSeconds]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {Object.keys(SecondsToDurationText).map((duration) => (
              <DropdownMenuItem
                key={duration}
                onClick={() => {
                  onChooseDuration(parseInt(duration) as Duration)
                }}
                className="cursor-pointer"
              >
                {SecondsToDurationText[parseInt(duration) as Duration]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button disabled={choices.length >= 5} onClick={() => onAddChoice()}>
          Add choice
        </Button>
      </div>
    </div>
  )
}
