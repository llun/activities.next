'use client'

import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import React, { FC } from 'react'

import { Button } from '@/lib/components/ui/button'

interface Props {}

export const RemoteStatusLoading: FC<Props> = () => {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <h1 className="mb-2 text-2xl font-bold">Fetching Remote Status</h1>
        <p className="text-muted-foreground">
          We are fetching this status from the remote server. This process might
          take a few moments.
        </p>
      </div>

      <div className="flex flex-col items-center space-y-6">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />

        <div className="max-w-md text-center text-sm text-muted-foreground">
          <p>
            The status content, along with its parent posts and replies, is
            being retrieved. It will be temporarily cached for 10 minutes.
          </p>
        </div>

        <div className="flex max-w-md items-center gap-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-950/20 dark:text-yellow-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            <h5 className="mb-1 font-medium">Please wait</h5>
            <p className="text-sm opacity-90">
              Once the loading spinner stops or after a few seconds, click the
              refresh button below to check if the content is ready.
            </p>
          </div>
        </div>

        <Button onClick={() => window.location.reload()} className="mt-4 gap-2">
          <RefreshCw className="h-4 w-4" />
          Check Again
        </Button>
      </div>
    </div>
  )
}
