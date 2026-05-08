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

  if (!isLoggedIn || relationship === null) return null

  const onBlock = async () => {
    setIsSubmitting(true)
    try {
      const nextRelationship = await blockAccount({ targetActorId })
      if (!nextRelationship) return

      setRelationship(nextRelationship)
      setIsBlockDialogOpen(false)
      router.refresh()
    } catch (_err) {
      return
    } finally {
      setIsSubmitting(false)
    }
  }

  const onUnblock = async () => {
    setIsSubmitting(true)
    try {
      const nextRelationship = await unblockAccount({ targetActorId })
      if (!nextRelationship) return

      setRelationship(nextRelationship)
      router.refresh()
    } catch (_err) {
      return
    } finally {
      setIsSubmitting(false)
    }
  }

  if (relationship.blocking) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={onUnblock}
        disabled={isSubmitting}
      >
        {isSubmitting ? <Loader2 className="animate-spin" /> : <Ban />}
        Unblock
      </Button>
    )
  }

  return (
    <Dialog open={isBlockDialogOpen} onOpenChange={setIsBlockDialogOpen}>
      <Button
        type="button"
        variant="destructive"
        onClick={() => setIsBlockDialogOpen(true)}
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
