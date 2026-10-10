import { MediaEditError } from '@/lib/client/mediaEdit'

export interface EditFailure {
  message: string
  /** The media changed somewhere else: offer to reload it. */
  reload: boolean
}

/** The Alert copy for a failed save or revert (§5.6). */
export const describeEditError = (error: unknown): EditFailure => {
  if (error instanceof MediaEditError) {
    // 409 `stale` (edited elsewhere) and 409 `Nothing to revert` (already
    // reverted elsewhere) both mean the editor's copy is out of date.
    if (error.status === 409) {
      return { message: 'This photo changed somewhere else.', reload: true }
    }
    if (error.status === 404) {
      return { message: 'This photo no longer exists.', reload: false }
    }
    if (error.status === 413) {
      // A quota 413 and an oversized-render 413 need different advice.
      return {
        message: /too large/i.test(error.error)
          ? 'The edited photo is too large to save.'
          : 'Not enough storage left for the edited photo.',
        reload: false
      }
    }
    if (error.status === 429) {
      return { message: 'Too many edits. Try again later.', reload: false }
    }
  }
  return { message: "Couldn't save the photo.", reload: false }
}

/**
 * True when a 409 `stale` answer carries the save id this client sent, which
 * means the first attempt landed and only its response was lost.
 */
export const isOwnSave = (error: unknown, saveId: string): boolean =>
  error instanceof MediaEditError &&
  error.status === 409 &&
  error.edit?.saveId === saveId

/** Runs `attempt`, and once more on a network error (not a server answer). */
export const withNetworkRetry = async <T>(
  attempt: () => Promise<T>
): Promise<T> => {
  try {
    return await attempt()
  } catch (error) {
    if (error instanceof MediaEditError) throw error
    return attempt()
  }
}
