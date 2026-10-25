'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { type FC, useEffect, useRef, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'
import type { FilterContext } from '@/lib/types/domain/filter'

import {
  DEFAULT_SERVER_FILTER_SELECTION,
  SERVER_FILTER_ACTION_OPTIONS,
  SERVER_FILTER_CONTEXT_OPTIONS,
  SERVER_FILTER_STATUS_OPTIONS,
  type ServerFilterSelection,
  countActiveServerFilters
} from './serverFilterControls'

interface ServerFilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selection: ServerFilterSelection
  onApply: (selection: ServerFilterSelection) => void
}

export const ServerFilterSheet: FC<ServerFilterSheetProps> = ({
  open,
  onOpenChange,
  selection,
  onApply
}) => {
  const [draft, setDraft] = useState(selection)
  const previousOpen = useRef(false)

  useEffect(() => {
    if (open && !previousOpen.current) setDraft(selection)
    previousOpen.current = open
  }, [open, selection])

  const updateContext = (context: FilterContext, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      contexts: checked
        ? [...current.contexts, context]
        : current.contexts.filter((value) => value !== context)
    }))
  }

  const activeCount = countActiveServerFilters(draft)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="bg-background dark:bg-card data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 motion-reduce:data-[state=open]:slide-in-from-bottom-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-48px)] w-full flex-col rounded-t-2xl border-t shadow-lg duration-200 ease-out outline-none sm:hidden"
        >
          <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
            <div
              aria-hidden="true"
              className="bg-muted-foreground/30 mx-auto mt-2 h-1 w-9 shrink-0 rounded-full"
            />

            <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={activeCount === 0}
                onClick={() => setDraft({ ...DEFAULT_SERVER_FILTER_SELECTION })}
                className="h-8 px-2 text-sm font-normal"
              >
                Clear filters
              </Button>
              <DialogTitle className="text-base font-semibold">
                Filters
              </DialogTitle>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onApply(draft)
                  onOpenChange(false)
                }}
                className="rounded-lg text-sm font-medium"
              >
                Apply
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
              <fieldset className="border-b py-3">
                <legend className="pb-2 text-sm font-medium">Action</legend>
                <RadioGroup
                  aria-label="Action"
                  value={draft.action}
                  onValueChange={(action) =>
                    setDraft((current) => ({
                      ...current,
                      action: action as ServerFilterSelection['action']
                    }))
                  }
                  className="grid grid-cols-2 gap-1"
                >
                  {SERVER_FILTER_ACTION_OPTIONS.map((option) => (
                    <RadioGroupItem
                      key={option.value}
                      value={option.value}
                      aria-label={option.label}
                      className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm"
                    >
                      <span className="text-foreground">{option.label}</span>
                    </RadioGroupItem>
                  ))}
                </RadioGroup>
              </fieldset>

              <fieldset className="border-b py-3">
                <legend className="pb-2 text-sm font-medium">Context</legend>
                <div className="grid grid-cols-2 gap-1">
                  {SERVER_FILTER_CONTEXT_OPTIONS.map((option, index) => {
                    const id = `server-filter-context-${index}`
                    return (
                      <label
                        key={option.value}
                        htmlFor={id}
                        className="hover:bg-muted/50 flex min-h-11 items-center gap-3 rounded-md px-2 text-sm"
                      >
                        <Checkbox
                          id={id}
                          checked={draft.contexts.includes(option.value)}
                          onChange={(event) =>
                            updateContext(option.value, event.target.checked)
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              <fieldset className="py-3">
                <legend className="pb-2 text-sm font-medium">Status</legend>
                <RadioGroup
                  aria-label="Status"
                  value={draft.status}
                  onValueChange={(status) =>
                    setDraft((current) => ({
                      ...current,
                      status: status as ServerFilterSelection['status']
                    }))
                  }
                  className="grid grid-cols-3 gap-1"
                >
                  {SERVER_FILTER_STATUS_OPTIONS.map((option) => (
                    <RadioGroupItem
                      key={option.value}
                      value={option.value}
                      aria-label={option.label}
                      className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm"
                    >
                      <span className="text-foreground">{option.label}</span>
                    </RadioGroupItem>
                  ))}
                </RadioGroup>
              </fieldset>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
