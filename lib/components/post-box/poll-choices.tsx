'use client'

import { XCircle } from 'lucide-react'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
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
  onAddChoice: () => void
  onRemoveChoice: (index: number) => void
  onChooseDuration: (durationInSeconds: Duration) => void
}

export const PollChoices: FC<Props> = ({
  show,
  choices,
  durationInSeconds,
  onAddChoice,
  onRemoveChoice,
  onChooseDuration
}) => {
  const [showDurationDropdown, setShowDurationDropdown] =
    useState<boolean>(false)

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
            value=""
            id="flexCheckDefault"
          />
          <label
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            htmlFor="flexCheckDefault"
          >
            Multiple Choices
          </label>
        </div>
        <div className="relative">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowDurationDropdown(!showDurationDropdown)}
          >
            {SecondsToDurationText[durationInSeconds]}
          </Button>
          {showDurationDropdown && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
              {Object.keys(SecondsToDurationText).map((duration) => (
                <button
                  className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                  key={duration}
                  onClick={(event) => {
                    event.preventDefault()
                    setShowDurationDropdown(false)
                    onChooseDuration(parseInt(duration) as Duration)
                  }}
                >
                  {SecondsToDurationText[parseInt(duration) as Duration]}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button disabled={choices.length >= 5} onClick={() => onAddChoice()}>
          Add choice
        </Button>
      </div>
    </div>
  )
}
