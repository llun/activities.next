'use client'

import { useRouter } from 'next/navigation'
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
  useState
} from 'react'

import {
  type StatusFitnessFileItem,
  makeFitnessFilePrimary
} from '@/lib/client'

import { getRecordingLabel } from './FitnessRecordingPicker'

export interface MakePrimaryRecording {
  recordingTriggerRef: RefObject<HTMLButtonElement | null>
  makingPrimaryId: string | null
  primaryNotice: string | null
  primaryError: { message: string; fileId: string } | null
  handleMakePrimary: (fitnessFileId: string) => Promise<void>
  retryMakePrimary: () => void
}

/** "Make primary" from the recording picker, with its notice and retry. */
export const useMakePrimaryRecording = ({
  fitnessFiles,
  setFitnessFiles,
  setSelectedFitnessFileId
}: {
  fitnessFiles: StatusFitnessFileItem[]
  setFitnessFiles: Dispatch<SetStateAction<StatusFitnessFileItem[]>>
  setSelectedFitnessFileId: Dispatch<SetStateAction<string | null>>
}): MakePrimaryRecording => {
  const router = useRouter()
  // Making a recording primary is one request for the whole activity, not one
  // per file, so a single slot of state is enough: the action is disabled while
  // it is in flight, and the message belongs to the activity rather than to
  // whichever recording is on screen.
  const recordingTriggerRef = useRef<HTMLButtonElement>(null)
  const [makingPrimaryId, setMakingPrimaryId] = useState<string | null>(null)
  const [primaryNotice, setPrimaryNotice] = useState<string | null>(null)
  // The file the failed attempt was for, so Retry tries the same one even if
  // the owner has since looked at another recording.
  const [primaryError, setPrimaryError] = useState<{
    message: string
    fileId: string
  } | null>(null)

  // Owner only (the recording picker offers it to no one else, and the endpoint
  // answers 404 to anyone but the owner). The server moves the flag, the gear
  // and the route map's pointers, then reprocesses the new primary so the post's
  // map is redrawn from it. With a real queue that happens after the response,
  // so the message says the map follows shortly and the page is re-read only
  // when the server reports the job already ran (a refresh before that would
  // just show the old map again).
  const handleMakePrimary = async (fitnessFileId: string) => {
    if (makingPrimaryId) return
    const target = fitnessFiles.find((file) => file.id === fitnessFileId)
    if (!target || target.isPrimary) {
      // Nothing left to do for this file (it already is the primary, or is
      // gone), so a failure shown for it has no action to offer.
      setPrimaryError((current) =>
        current?.fileId === fitnessFileId ? null : current
      )
      return
    }

    setMakingPrimaryId(fitnessFileId)
    setPrimaryNotice(null)
    setPrimaryError(null)

    try {
      const {
        file: updated,
        processed,
        alreadyPrimary
      } = await makeFitnessFilePrimary(fitnessFileId)
      // The response is the new primary as the server now holds it (it may have
      // inherited the old primary's gear); every other file just lost the flag.
      setFitnessFiles((files) =>
        files.map((file) =>
          file.id === fitnessFileId
            ? { ...file, ...updated, isPrimary: true }
            : { ...file, isPrimary: false }
        )
      )
      setSelectedFitnessFileId(fitnessFileId)
      const label = getRecordingLabel(target)
      setPrimaryNotice(
        alreadyPrimary
          ? `${label} is already the primary recording.`
          : processed
            ? `${label} is now the primary recording.`
            : `${label} is now the primary recording. The route map updates shortly.`
      )
      if (processed && !alreadyPrimary) router.refresh()
    } catch (error) {
      setPrimaryError({
        message:
          error instanceof Error
            ? error.message
            : 'Failed to make this the primary recording.',
        fileId: fitnessFileId
      })
    } finally {
      setMakingPrimaryId(null)
    }
  }

  // Retry is a first attempt again, except for where focus goes. Focus moves to
  // the picker trigger BEFORE the Alert unmounts (the Alert holds it until
  // then, so it is never dropped to the page body); after that nothing touches
  // focus, so a slow request cannot pull it back from wherever the owner went.
  // A repeat failure mounts a fresh Alert, which a screen reader announces even
  // when the message is the same as before.
  const retryMakePrimary = () => {
    if (!primaryError) return
    recordingTriggerRef.current?.focus()
    void handleMakePrimary(primaryError.fileId)
  }

  return {
    recordingTriggerRef,
    makingPrimaryId,
    primaryNotice,
    primaryError,
    handleMakePrimary,
    retryMakePrimary
  }
}
