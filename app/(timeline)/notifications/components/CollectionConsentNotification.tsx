'use client'

import { Check, EyeOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import {
  approveCollectionMembership,
  revokeCollectionMembership
} from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  // The collection the member was added to.
  collectionId: string
  collectionTitle: string
  // The member's own Mastodon Account id (the `urlToId`-encoded actor id). The
  // approve/revoke routes require it to resolve to the authenticated caller.
  accountId: string
}

// The consent gate for a collection the member was added to: they choose whether
// to appear on the collection's public link. The owner always keeps them in the
// private feed; this only controls the public projection. Mirrors
// FollowRequestNotification's inline-action pattern.
export const CollectionConsentNotification: FC<Props> = ({
  collectionId,
  collectionTitle,
  accountId
}) => {
  const router = useRouter()
  const [state, setState] = useState<'pending' | 'approved' | 'revoked'>(
    'pending'
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const respond = async (action: 'approve' | 'revoke') => {
    setIsLoading(true)
    setError(null)
    try {
      const ok =
        action === 'approve'
          ? await approveCollectionMembership({ collectionId, accountId })
          : await revokeCollectionMembership({ collectionId, accountId })
      if (!ok) throw new Error('request failed')
      setState(action === 'approve' ? 'approved' : 'revoked')
      router.refresh()
    } catch {
      setError(
        action === 'approve'
          ? 'Could not update your choice. Please try again.'
          : 'Could not update your choice. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mt-1.5 space-y-2">
      <p className="truncate text-[13px] font-medium text-foreground">
        {collectionTitle}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={state === 'approved' ? 'default' : 'outline'}
          onClick={() => respond('approve')}
          disabled={isLoading}
        >
          <Check className="h-4 w-4" />
          Show me publicly
        </Button>
        <Button
          size="sm"
          variant={state === 'revoked' ? 'default' : 'outline'}
          onClick={() => respond('revoke')}
          disabled={isLoading}
        >
          <EyeOff className="h-4 w-4" />
          Keep me hidden
        </Button>
        {state !== 'pending' && (
          <span
            className={cn(
              'text-[13px] font-medium',
              state === 'approved'
                ? 'text-green-600 dark:text-green-500'
                : 'text-muted-foreground'
            )}
          >
            {state === 'approved' ? 'Featured publicly' : 'Hidden'}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        The owner always keeps you in their own feed. This only controls the
        public link.
      </p>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
