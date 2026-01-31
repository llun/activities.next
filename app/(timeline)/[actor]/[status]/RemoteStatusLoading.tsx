'use client'

import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import React from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/lib/components/ui/alert'
import { Button } from '@/lib/components/ui/button'

interface Props {
  statusId: string
}

export const RemoteStatusLoading: React.FC<Props> = ({ statusId }) => {
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

        <Alert className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Please wait</AlertTitle>
          <AlertDescription>
            Once the loading spinner stops or after a few seconds, click the
            refresh button below to check if the content is ready.
          </AlertDescription>
        </Alert>

        <Button onClick={() => window.location.reload()} className="mt-4 gap-2">
          <RefreshCw className="h-4 w-4" />
          Check Again
        </Button>
      </div>
    </div>
  )
}
