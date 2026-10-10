'use client'

import type { ReactNode } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'

interface Props {
  open: boolean
  title: string
  description?: ReactNode
  cancelLabel: string
  confirmLabel: string
  /** `destructive` styles the confirm button for something that can't be undone. */
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** A two-button question: "Discard your edits?", "Revert to original?". */
export const ConfirmDialog = ({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm
}: Props) => (
  <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
    <DialogContent
      showCloseButton={false}
      {...(description ? {} : { 'aria-describedby': undefined })}
      className="motion-reduce:animate-none"
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? (
          <DialogDescription>{description}</DialogDescription>
        ) : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={destructive ? 'destructive' : 'default'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)
