'use client'

import { Loader2, VolumeX } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { mute as muteAccount, unmute as unmuteAccount } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

interface MuteActionProps {
  targetActorId: string
  isLoggedIn: boolean
  initialRelationship: MastodonRelationship | null
}

export const MuteAction: FC<MuteActionProps> = ({
  targetActorId,
  isLoggedIn,
  initialRelationship
}) => {
  const router = useRouter()
  const [relationship, setRelationship] = useState<MastodonRelationship | null>(
    initialRelationship
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isMuteDialogOpen, setIsMuteDialogOpen] = useState(false)
  const [muteNotifications, setMuteNotifications] = useState(true)
  const [error, setError] = useState('')

  if (!isLoggedIn || relationship === null) return null

  const onMute = async () => {
    setError('')
    setIsSubmitting(true)
    try {
      const next = await muteAccount({
        targetActorId,
        notifications: muteNotifications
      })
      if (!next || !next.muting) {
        setError('Failed to mute account. Please try again.')
        return
      }
      setRelationship(next)
      setIsMuteDialogOpen(false)
      router.refresh()
    } catch (_err) {
      setError('Failed to mute account. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const onUnmute = async () => {
    setError('')
    setIsSubmitting(true)
    try {
      const next = await unmuteAccount({ targetActorId })
      if (!next || next.muting) {
        setError('Failed to unmute account. Please try again.')
        return
      }
      setRelationship(next)
      router.refresh()
    } catch (_err) {
      setError('Failed to unmute account. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (relationship.muting) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="outline"
          onClick={onUnmute}
          disabled={isSubmitting}
        >
          {isSubmitting ? <Loader2 className="animate-spin" /> : <VolumeX />}
          Unmute
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setError('')
          setMuteNotifications(true)
          setIsMuteDialogOpen(true)
        }}
        disabled={isSubmitting}
      >
        {isSubmitting ? <Loader2 className="animate-spin" /> : <VolumeX />}
        Mute
      </Button>
      <Dialog
        open={isMuteDialogOpen}
        onOpenChange={(open) => {
          if (isSubmitting) return
          setError('')
          setIsMuteDialogOpen(open)
          if (open) setMuteNotifications(true)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mute account</DialogTitle>
            <DialogDescription>
              Posts from this actor will be hidden from your timelines. They can
              still see and reply to your posts.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={muteNotifications}
              onChange={(event) => setMuteNotifications(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Also hide notifications from this actor
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsMuteDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onMute} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : null}
              Mute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
