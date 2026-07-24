'use client'

import { FC, ReactNode, useEffect, useRef, useState } from 'react'

import { Input } from '@/lib/components/ui/input'

// A numeric input with an optional trailing unit. Keeps a local text buffer so
// clearing/retyping stays smooth, and only emits finite numbers. Re-syncs the
// buffer when the external value changes to one the buffer did not produce
// (e.g. after a save).
interface NumberFieldProps {
  id?: string
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  suffix?: ReactNode
  min?: number
  max?: number
  // For inputs the field label does not point at — e.g. the custom post size,
  // where the label belongs to the preset select next to it.
  ariaLabel?: string
}

export const NumberField: FC<NumberFieldProps> = ({
  id,
  value,
  onChange,
  disabled,
  suffix,
  min,
  max,
  ariaLabel
}) => {
  const [text, setText] = useState(() => String(value))
  const lastEmitted = useRef(value)

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(String(value))
      lastEmitted.current = value
    }
  }, [value])

  const handleChange = (raw: string) => {
    setText(raw)
    if (raw.trim() === '') return
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) {
      lastEmitted.current = parsed
      onChange(parsed)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        value={text}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => handleChange(event.target.value)}
        className="w-40"
      />
      {suffix && (
        <span className="text-sm text-muted-foreground">{suffix}</span>
      )}
    </div>
  )
}
