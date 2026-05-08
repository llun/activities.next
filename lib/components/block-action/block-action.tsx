'use client'

import { Ban, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import {
  block as blockAccount,
  getRelationship,
  unblock as unblockAccount
} from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

interface BlockActionProps {
  targetActorId: string
  isLoggedIn: boolean
}

export const BlockAction: FC<BlockActionProps> = ({
  targetActorId,
  isLoggedIn
}) => {
  const router = useRouter()
  const [relationship, setRelationship] =
    useState<MastodonRelationship | null>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!isLoggedIn) return
    getRelationship({ targetActorId }).then(setRelationship)
  }, [isLoggedIn, targetActorId])

  if (!isLoggedIn || relationship === undefined) return null

  const onBlock = async () => {
    const confirmed = window.confirm(
      'Block this actor? This removes follow relationships in both directions.'
    )
    if (!confirmed) return

    setIsSubmitting(true)
    const nextRelationship = await blockAccount({ targetActorId })
    setIsSubmitting(false)
    if (!nextRelationship) return

    setRelationship(nextRelationship)
    router.refresh()
  }

  const onUnblock = async () => {
    setIsSubmitting(true)
    const nextRelationship = await unblockAccount({ targetActorId })
    setIsSubmitting(false)
    if (!nextRelationship) return

    setRelationship(nextRelationship)
    router.refresh()
  }

  return (
    <Button
      type="button"
      variant={relationship?.blocking ? 'outline' : 'destructive'}
      onClick={relationship?.blocking ? onUnblock : onBlock}
      disabled={isSubmitting}
    >
      {isSubmitting ? <Loader2 className="animate-spin" /> : <Ban />}
      {relationship?.blocking ? 'Unblock' : 'Block'}
    </Button>
  )
}
