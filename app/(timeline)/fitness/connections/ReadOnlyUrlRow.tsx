'use client'

import { Check } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { FormRow } from '@/lib/components/surface/FormRow'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { useCopyToClipboard } from '@/lib/hooks/useCopyToClipboard'

interface Props {
  id: string
  label: string
  value: string
  hint?: ReactNode
}

/** A read-only URL with a Copy button, for the values pasted into a provider. */
export const ReadOnlyUrlRow: FC<Props> = ({ id, label, value, hint }) => {
  const { copied, copy } = useCopyToClipboard(2000)
  return (
    <FormRow label={label} htmlFor={id} hint={hint}>
      {({ describedBy }) => (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            readOnly
            value={value}
            onFocus={(event) => event.currentTarget.select()}
            aria-describedby={describedBy}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={() => void copy(value)}
          >
            {copied ? <Check className="size-3" aria-hidden /> : null}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}
    </FormRow>
  )
}
