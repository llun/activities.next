import type { MaskPoint } from '@/lib/services/medias/edit/recipe'

import type { SamRequest, SamResponse } from './samMessages'

/** A mask as the model returns it: 0 or 255 per pixel. */
export interface SamMask {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

/**
 * The page's side of the segmentation worker. Requests queue up and run one
 * at a time: each method resolves with the worker's answer or rejects with
 * its error.
 */
export interface SamClient {
  /** Hands the downloaded model files to the worker (ownership moves). */
  load: (encoder: ArrayBuffer, decoder: ArrayBuffer) => Promise<void>
  /** Runs the image encoder; `bitmap` is transferred and closed. */
  embed: (bitmap: ImageBitmap) => Promise<void>
  segment: (points: MaskPoint[]) => Promise<SamMask>
  dispose: () => void
}

const CLOSED_MESSAGE = 'The model was closed'

export const createSamClient = (): SamClient => {
  const worker = new Worker(new URL('./sam.worker.ts', import.meta.url), {
    type: 'module'
  })
  let closed = false
  let pending: {
    resolve: (message: SamResponse) => void
    reject: (error: Error) => void
  } | null = null

  worker.onmessage = (event: MessageEvent<SamResponse>) => {
    const current = pending
    pending = null
    if (!current) return
    if (event.data.type === 'error') {
      current.reject(new Error(event.data.message))
    } else {
      current.resolve(event.data)
    }
  }
  worker.onerror = (event) => {
    const current = pending
    pending = null
    current?.reject(new Error(event.message || 'The model stopped'))
  }

  // Requests run one after another; the worker answers each in order.
  let queue: Promise<unknown> = Promise.resolve()
  const request = (
    message: SamRequest,
    transfer: Transferable[] = []
  ): Promise<SamResponse> => {
    const run = () =>
      new Promise<SamResponse>((resolve, reject) => {
        // A request that was queued behind the one in flight, or that was
        // made after dispose, has no worker left to answer it.
        if (closed) {
          reject(new Error(CLOSED_MESSAGE))
          return
        }
        pending = { resolve, reject }
        worker.postMessage(message, transfer)
      })
    const result = queue.then(run, run)
    queue = result.catch(() => undefined)
    return result
  }

  return {
    load: async (encoder, decoder) => {
      await request({ type: 'load', encoder, decoder }, [encoder, decoder])
    },
    embed: async (bitmap) => {
      await request({ type: 'embed', bitmap }, [bitmap])
    },
    segment: async (points) => {
      const answer = await request({ type: 'segment', points })
      if (answer.type !== 'mask') throw new Error('Unexpected model answer')
      return { width: answer.width, height: answer.height, data: answer.data }
    },
    dispose: () => {
      closed = true
      pending?.reject(new Error(CLOSED_MESSAGE))
      pending = null
      worker.terminate()
    }
  }
}
