'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import {
  type ReportCategory,
  block,
  createReport,
  deleteStatus,
  mute
} from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Label } from '@/lib/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'
import { Textarea } from '@/lib/components/ui/textarea'
import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'spam', label: "It's spam" },
  { value: 'violation', label: 'It violates server rules' },
  { value: 'legal', label: "It's illegal" },
  { value: 'other', label: "It's something else" }
]

const errorAlert = (error: string | null) =>
  error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null

interface MuteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actorName: string
  targetActorId: string
  onMuted: (relationship: MastodonRelationship) => void
}

export const MuteDialog: FC<MuteDialogProps> = ({
  open,
  onOpenChange,
  actorName,
  targetActorId,
  onMuted
}) => {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notifications, setNotifications] = useState(true)

  useEffect(() => {
    if (open) {
      setError(null)
      setNotifications(true)
    }
  }, [open])

  const onMute = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const next = await mute({ targetActorId, notifications })
      if (!next || !next.muting) {
        setError('Failed to mute account. Please try again.')
        return
      }
      onMuted(next)
      onOpenChange(false)
      router.refresh()
    } catch {
      setError('Failed to mute account. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mute {actorName}?</DialogTitle>
          <DialogDescription>
            Posts from this account will be hidden from your timelines. They can
            still see and reply to your posts.
          </DialogDescription>
        </DialogHeader>
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
          />
          Also hide notifications from this account
        </Label>
        {errorAlert(error)}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void onMute()}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Mute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface BlockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actorName: string
  targetActorId: string
  onBlocked: (relationship: MastodonRelationship) => void
}

export const BlockDialog: FC<BlockDialogProps> = ({
  open,
  onOpenChange,
  actorName,
  targetActorId,
  onBlocked
}) => {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  const onBlock = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const next = await block({ targetActorId })
      if (!next || !next.blocking) {
        setError('Failed to block account. Please try again.')
        return
      }
      onBlocked(next)
      onOpenChange(false)
      router.refresh()
    } catch {
      setError('Failed to block account. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block {actorName}?</DialogTitle>
          <DialogDescription>
            They will not be able to follow you or see your posts, and you will
            not see posts or notifications from them.
          </DialogDescription>
        </DialogHeader>
        {errorAlert(error)}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onBlock()}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetActorId: string
  statusId: string
}

export const ReportDialog: FC<ReportDialogProps> = ({
  open,
  onOpenChange,
  targetActorId,
  statusId
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<ReportCategory>('spam')
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (open) {
      setError(null)
      setCategory('spam')
      setComment('')
    }
  }, [open])

  const onReport = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const success = await createReport({
        targetActorId,
        statusId,
        category,
        comment: comment.trim() || undefined
      })
      if (!success) {
        setError('Failed to submit report. Please try again.')
        return
      }
      onOpenChange(false)
    } catch {
      setError('Failed to submit report. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report post</DialogTitle>
          <DialogDescription>
            Let the moderators know what&apos;s wrong with this post. Your
            report is sent to the moderators of your server.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">
            Why are you reporting this post?
          </legend>
          <RadioGroup
            value={category}
            onValueChange={(value) => setCategory(value as ReportCategory)}
          >
            {REPORT_CATEGORIES.map((option) => (
              <Label
                key={option.value}
                className="flex items-center gap-2 text-sm font-normal"
              >
                <RadioGroupItem value={option.value} />
                {option.label}
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          placeholder="Additional comments (optional)"
          aria-label="Additional comments"
          rows={3}
        />
        {errorAlert(error)}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onReport()}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface DeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: StatusNote | StatusPoll
  onPostDeleted?: (status: Status) => void
}

export const DeleteDialog: FC<DeleteDialogProps> = ({
  open,
  onOpenChange,
  status,
  onPostDeleted
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  const onDelete = async () => {
    setSubmitting(true)
    setError(null)
    let deleted = false
    try {
      deleted = await deleteStatus({ statusId: status.id })
      if (!deleted) {
        setError('Failed to delete post. Please try again.')
      }
    } catch {
      setError('Failed to delete post. Please try again.')
    } finally {
      setSubmitting(false)
    }
    // Run success side-effects outside the try so a throwing onPostDeleted
    // callback can't mislabel a delete that already succeeded.
    if (deleted) {
      onOpenChange(false)
      onPostDeleted?.(status)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this post?</DialogTitle>
          <DialogDescription>
            This can&apos;t be undone. The post will be removed from your
            profile and the timelines of anyone who follows you.
          </DialogDescription>
        </DialogHeader>
        {errorAlert(error)}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onDelete()}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
