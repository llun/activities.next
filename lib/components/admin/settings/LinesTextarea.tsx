'use client'

import { FC, useEffect, useRef, useState } from 'react'

import { Textarea } from '@/lib/components/ui/textarea'
import { cn } from '@/lib/utils'

// Edits a string[] as one value per line. Keeps a local text buffer so typing
// (including blank lines) stays smooth, and only emits trimmed, non-empty
// lines. Re-syncs the buffer when the external value changes to something the
// buffer did not produce (e.g. after a save normalizes or reorders the list).
interface LinesTextareaProps {
  id?: string
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  rows?: number
  placeholder?: string
  className?: string
  'aria-label'?: string
}

const sameLines = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index])

export const LinesTextarea: FC<LinesTextareaProps> = ({
  id,
  value,
  onChange,
  disabled,
  rows = 3,
  placeholder,
  className,
  'aria-label': ariaLabel
}) => {
  const [text, setText] = useState(() => value.join('\n'))
  const lastEmitted = useRef<string[]>(value)

  useEffect(() => {
    if (!sameLines(value, lastEmitted.current)) {
      setText(value.join('\n'))
      lastEmitted.current = value
    }
  }, [value])

  const handleChange = (next: string) => {
    setText(next)
    const lines = next
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    lastEmitted.current = lines
    onChange(lines)
  }

  return (
    <Textarea
      id={id}
      value={text}
      onChange={(event) => handleChange(event.target.value)}
      disabled={disabled}
      rows={rows}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn('font-mono text-[13px]', className)}
    />
  )
}
