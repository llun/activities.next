'use client'

import { formatDistanceToNowStrict } from 'date-fns/formatDistanceToNowStrict'
import { SlidersHorizontal } from 'lucide-react'
import dynamic from 'next/dynamic'
import { type FC, type ReactNode, useState } from 'react'

import {
  type ApplyToPosts,
  type MediaEditState,
  getMediaEdit,
  revertMediaEdit
} from '@/lib/client/mediaEdit'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/lib/components/ui/tooltip'
import type {
  MediaDetailsEntity,
  MediaStorageSaveFileOutput
} from '@/lib/services/medias/types'

import { ConfirmDialog } from './ConfirmDialog'
import type { EditedPosts } from './PhotoEditorDialog'
import { SavePrompt } from './SavePrompt'
import { describeEditError, isOwnSave, withNetworkRetry } from './editErrors'
import { isWebGl2Supported } from './engine/webglSupport'

const PhotoEditorDialog = dynamic(() => import('./PhotoEditorDialog'), {
  ssr: false
})

/** The slice of a media dialog item this component reads. */
interface PreviewItem {
  id: string
  mediaType: string
  details?: object | null
}

interface Props {
  item: PreviewItem
  /** The existing preview image. */
  children: ReactNode
  onEdited: (id: string, media: MediaStorageSaveFileOutput) => void
}

const EDITABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Still images the editor can open (the server checks the rest). */
export const isEditableItem = (item: Pick<PreviewItem, 'mediaType'>) =>
  EDITABLE_TYPES.includes(item.mediaType.toLowerCase())

// `details.edit` is the server's `{ version, editedAt }`. It is read through a
// narrow type so this file compiles with or without the field on the entity.
const getEditedAt = (item: PreviewItem): Date | null => {
  const edit = (item.details as { edit?: { editedAt?: string | null } } | null)
    ?.edit
  if (!edit?.editedAt) return null
  const date = new Date(edit.editedAt)
  return Number.isNaN(date.getTime()) ? null : date
}

type RevertStep = 'idle' | 'confirm' | 'loading' | 'prompt' | 'working'

/**
 * Wraps the media dialog's preview image with the "Edit photo" pill, the
 * "Edited 2 min ago · Revert to original" line, and the editor itself.
 */
export const PhotoEditPreview: FC<Props> = ({ item, children, onEdited }) => {
  const [open, setOpen] = useState(false)
  const [skipped, setSkipped] = useState(0)
  const [revertStep, setRevertStep] = useState<RevertStep>('idle')
  const [revertState, setRevertState] = useState<MediaEditState | null>(null)
  const [revertError, setRevertError] = useState<string | null>(null)
  const [webGl2] = useState(() => isWebGl2Supported())

  const editable = isEditableItem(item)
  const editedAt = getEditedAt(item)
  const details = (item.details ?? null) as MediaDetailsEntity | null

  const finish = (media: MediaStorageSaveFileOutput, posts: EditedPosts) => {
    setSkipped(posts.skipped.length)
    setOpen(false)
    setRevertStep('idle')
    onEdited(item.id, media)
  }

  const startRevert = async () => {
    setRevertError(null)
    setRevertStep('loading')
    try {
      const state = await getMediaEdit(item.id)
      setRevertState(state)
      if (state.usage.statusCount > 0) setRevertStep('prompt')
      else await runRevert(state, undefined)
    } catch (error) {
      setRevertError(describeEditError(error).message)
      setRevertStep('idle')
    }
  }

  const runRevert = async (
    state: MediaEditState,
    applyToPosts: ApplyToPosts | undefined
  ) => {
    setRevertStep('working')
    const saveId = crypto.randomUUID()
    try {
      const result = await withNetworkRetry(() =>
        revertMediaEdit(item.id, {
          baseVersion: state.edit.version,
          saveId,
          applyToPosts
        })
      )
      finish(result.media, result.posts)
    } catch (error) {
      if (isOwnSave(error, saveId)) {
        try {
          const fresh = await getMediaEdit(item.id)
          finish(fresh.media, { updated: [], skipped: [] })
          return
        } catch (refetchError) {
          setRevertError(describeEditError(refetchError).message)
          setRevertStep('idle')
          return
        }
      }
      setRevertError(describeEditError(error).message)
      setRevertStep('idle')
    }
  }

  const pill = (
    <Button
      type="button"
      variant="pill"
      size="sm"
      disabled={!webGl2}
      onClick={() => setOpen(true)}
      className="absolute right-3 bottom-3 border-transparent bg-black/60 text-white backdrop-blur hover:bg-black/70 hover:text-white disabled:opacity-60 dark:border-transparent dark:bg-black/60 dark:hover:bg-black/70"
    >
      <SlidersHorizontal aria-hidden="true" />
      Edit photo
    </Button>
  )

  const busy = revertStep === 'loading' || revertStep === 'working'

  return (
    <div className="w-full">
      <div className="relative w-full">
        {children}
        {editable ? (
          webGl2 ? (
            pill
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="absolute right-3 bottom-3 rounded-full"
                >
                  {pill}
                </span>
              </TooltipTrigger>
              <TooltipContent>Photo editing needs WebGL 2</TooltipContent>
            </Tooltip>
          )
        ) : null}
      </div>
      {editable && editedAt ? (
        <p className="px-1 pt-2 text-xs text-muted-foreground">
          Edited{' '}
          <time dateTime={editedAt.toISOString()}>
            {formatDistanceToNowStrict(editedAt, { addSuffix: true })}
          </time>{' '}
          ·{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-xs"
            disabled={busy}
            aria-label="Revert to original"
            onClick={() => setRevertStep('confirm')}
          >
            <span className="sm:hidden">Revert</span>
            <span className="hidden sm:inline">Revert to original</span>
          </Button>
        </p>
      ) : null}
      {skipped > 0 ? (
        <Alert
          tone="warning"
          className="mt-2"
          title={`Saved. ${skipped} ${skipped === 1 ? "post couldn't" : "posts couldn't"} be updated.`}
        />
      ) : null}
      {revertError ? <Alert className="mt-2" title={revertError} /> : null}

      {open ? (
        <PhotoEditorDialog
          mediaId={item.id}
          details={details}
          onClose={() => setOpen(false)}
          onSaved={finish}
        />
      ) : null}

      <ConfirmDialog
        open={revertStep === 'confirm'}
        title="Revert to original?"
        description="Your edits are removed and the photo goes back to how you uploaded it."
        cancelLabel="Cancel"
        confirmLabel="Revert"
        destructive
        onCancel={() => setRevertStep('idle')}
        onConfirm={() => void startRevert()}
      />
      <SavePrompt
        open={revertStep === 'prompt'}
        count={revertState?.usage.statusCount ?? 0}
        latestStatusAt={revertState?.usage.latestStatusAt ?? null}
        onKeepEditing={() => setRevertStep('idle')}
        onSave={(choice) => {
          if (revertState) void runRevert(revertState, choice)
        }}
      />
    </div>
  )
}
