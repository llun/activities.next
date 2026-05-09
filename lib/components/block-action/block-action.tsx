'use client'

import { Ban, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { block as blockAccount, unblock as unblockAccount } from '@/lib/client'
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

interface BlockActionProps {
  targetActorId: string
  isLoggedIn: boolean
  initialRelationship: MastodonRelationship | null
}

export const BlockAction: FC<BlockActionProps> = ({
  targetActorId,
  isLoggedIn,
  initialRelationship
}) => {
  const router = useRouter()
  const [relationship, setRelationship] = useState<MastodonRelationship | null>(
    initialRelationship
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isBlockDialogOpen, setIsBlockDialogOpen] = useState(false)
  const [error, setError] = useState('')

  if (!isLoggedIn || relationship === null) return null

  const onBlock = async () => {
    setError('')
    setIsSubmitting(true)
    try {
      const nextRelationship = await blockAccount({ targetActorId })
      if (!nextRelationship || !nextRelationship.blocking) {
        setError('Failed to block account. Please try again.')
        return
      }

      setRelationship(nextRelationship)
      setIsBlockDialogOpen(false)
      router.refresh()
    } catch (_err) {
      setError('Failed to block account. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const onUnblock = async () => {
    setError('')
    setIsSubmitting(true)
    try {
      const nextRelationship = await unblockAccount({ targetActorId })
      if (!nextRelationship || nextRelationship.blocking) {
        setError('Failed to unblock account. Please try again.')
        return
      }

      setRelationship(nextRelationship)
      router.refresh()
    } catch (_err) {
      setError('Failed to unblock account. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (relationship.blocking) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="outline"
          onClick={onUnblock}
          disabled={isSubmitting}
        >
          {isSubmitting ? <Loader2 className="animate-spin" /> : <Ban />}
          Unblock
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
    <Dialog
      open={isBlockDialogOpen}
      onOpenChange={(open) => {
        setError('')
        setIsBlockDialogOpen(open)
      }}
    >
      <Button
        type="button"
        variant="destructive"
        onClick={() => {
          setError('')
          setIsBlockDialogOpen(true)
        }}
        disabled={isSubmitting}
      >
        {isSubmitting ? <Loader2 className="animate-spin" /> : <Ban />}
        Block
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block account</DialogTitle>
          <DialogDescription>
            This removes follow relationships in both directions and hides this
            actor from your timelines.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsBlockDialogOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onBlock}
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className="animate-spin" /> : null}
            Block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
