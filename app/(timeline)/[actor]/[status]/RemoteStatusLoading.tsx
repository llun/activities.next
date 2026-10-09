'use client'

import { RefreshCw } from 'lucide-react'
import { FC } from 'react'

import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'

export const RemoteStatusLoading: FC = () => {
  return (
    <div className="space-y-6 md:pt-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Fetching remote status
        </h1>
        <p className="text-sm text-muted-foreground">
          We are fetching this status from the remote server. This might take a
          few moments.
        </p>
      </div>

      <div role="status">
        <span className="sr-only">Fetching the status</span>
        <PostListSkeleton rows={2} />
      </div>

      <Alert
        tone="info"
        live={false}
        title="Please wait"
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            <RefreshCw aria-hidden="true" />
            Check again
          </Button>
        }
      >
        The status, along with its parent posts and replies, is being retrieved
        and is cached for 10 minutes. After a few seconds, check again to see if
        it is ready.
      </Alert>
    </div>
  )
}
