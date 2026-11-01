'use client'

import { useEffect } from 'react'

import { isChunkLoadError } from '@/lib/client/chunkLoadRecovery'
import { reportClientError } from '@/lib/client/clientErrors'

export function ChunkLoadErrorListener() {
  useEffect(() => {
    // Only report: the page is still alive, so reloading could destroy text the user is typing.
    const onError = (event: ErrorEvent) => {
      const error = event.error ?? event.message
      if (isChunkLoadError(error)) {
        reportClientError(error, 'chunk-load')
      }
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason
      if (isChunkLoadError(error)) {
        reportClientError(error, 'chunk-load')
      }
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  return null
}
