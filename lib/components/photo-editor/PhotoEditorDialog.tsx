'use client'

import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  type ApplyToPosts,
  type MediaEditSaveResult,
  type MediaEditState,
  getMediaEdit,
  getMediaEditSourceUrl,
  revertMediaEdit,
  saveMediaEdit
} from '@/lib/client/mediaEdit'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import { Dialog, DialogContent } from '@/lib/components/ui/dialog'
import { Tabs } from '@/lib/components/ui/tabs'
import {
  MAX_SOURCE_PIXELS,
  NEUTRAL_RECIPE,
  type Recipe,
  isNeutralRecipe,
  normalizeRecipe,
  parseStoredRecipe
} from '@/lib/services/medias/edit/recipe'
import type {
  AdjustmentKey,
  CropRect,
  Geometry
} from '@/lib/services/medias/edit/recipe'
import type {
  MediaDetailsEntity,
  MediaStorageSaveFileOutput
} from '@/lib/services/medias/types'

import { ConfirmDialog } from './ConfirmDialog'
import { EditorPanel } from './EditorPanel'
import { EditorPhoneControls } from './EditorPhoneControls'
import { EditorStage } from './EditorStage'
import { EditorTopBar } from './EditorTopBar'
import { SavePrompt } from './SavePrompt'
import {
  CONTROLS_BY_KEY,
  type ControlGroup,
  controlsIn
} from './adjustmentControls'
import {
  type EditFailure,
  describeEditError,
  isOwnSave,
  withNetworkRetry
} from './editErrors'
import type { EditorControls } from './editorControls'
import { recipesEqual, setAdjustment, withGeometry } from './editorRecipe'
import { AUTO_KEYS, computeAuto } from './engine/auto'
import { exportRecipe } from './engine/exportImage'
import { loadSource } from './engine/loadSource'
import { useEditorHistory } from './useEditorHistory'
import { useEditorShortcuts } from './useEditorShortcuts'
import { useIsDesktop } from './useIsDesktop'
import { type EditorTab, useRenderer } from './useRenderer'

export interface EditedPosts {
  updated: string[]
  skipped: string[]
}

interface Props {
  mediaId: string
  /** The owner details the media dialog holds, for the camera line. */
  details?: MediaDetailsEntity | null
  onClose: () => void
  /** Called once a save or revert went through; the caller closes the editor. */
  onSaved: (media: MediaStorageSaveFileOutput, posts: EditedPosts) => void
}

type Phase = 'loading' | 'ready' | 'saving' | 'error'

const NO_POSTS: EditedPosts = { updated: [], skipped: [] }

const describeAuto = (count: number) =>
  count === 0
    ? 'Looks good already'
    : `${count} ${count === 1 ? 'change' : 'changes'}`

/**
 * The full-screen photo editor. It loads the saved recipe and the original,
 * keeps the history, renders the preview, and saves the rendered result.
 */
export const PhotoEditorDialog = ({
  mediaId,
  details,
  onClose,
  onSaved
}: Props) => {
  const isDesktop = useIsDesktop()
  const history = useEditorHistory(NEUTRAL_RECIPE)
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tooLarge, setTooLarge] = useState(false)
  const [loadVersion, setLoadVersion] = useState(0)
  const [editState, setEditState] = useState<MediaEditState | null>(null)
  const [baseline, setBaseline] = useState<Recipe>(NEUTRAL_RECIPE)
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [tab, setTab] = useState<EditorTab>('adjust')
  const [phoneCategory, setPhoneCategory] = useState<ControlGroup>('light')
  const [selectedControl, setSelectedControl] =
    useState<AdjustmentKey>('exposure')
  const [comparing, setComparingState] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [autoStatus, setAutoStatus] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [reloadOpen, setReloadOpen] = useState(false)
  const [failure, setFailure] = useState<EditFailure | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)

  const { reset: resetHistory } = history
  const present = history.present
  const ready = phase === 'ready'
  const saving = phase === 'saving'

  const renderer = useRenderer({
    containerRef,
    canvasRef,
    bitmap,
    recipe: present,
    tab
  })

  // Load the saved recipe and the unedited original.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    ;(async () => {
      try {
        const state = await getMediaEdit(mediaId)
        if (cancelled) return
        const { width, height } = state.edit.source
        if (width * height > MAX_SOURCE_PIXELS) {
          setTooLarge(true)
          setPhase('error')
          return
        }
        const decoded = await loadSource(
          getMediaEditSourceUrl(mediaId),
          controller.signal
        )
        if (cancelled) {
          decoded.close?.()
          return
        }
        const stored = state.edit.recipe
          ? parseStoredRecipe(JSON.stringify(state.edit.recipe))
          : null
        const start = stored ?? NEUTRAL_RECIPE
        bitmapRef.current?.close?.()
        bitmapRef.current = decoded
        setBitmap(decoded)
        setEditState(state)
        setBaseline(start)
        resetHistory(start)
        setPhase('ready')
      } catch {
        if (cancelled) return
        setLoadError("Couldn't load the photo.")
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [mediaId, loadVersion, resetHistory])

  useEffect(
    () => () => {
      bitmapRef.current?.close?.()
      bitmapRef.current = null
    },
    []
  )

  const edited = Boolean(editState?.edit.editedAt || editState?.edit.recipe)
  const dirty = ready && !recipesEqual(present, baseline)
  const revertsToOriginal = isNeutralRecipe(present) && edited
  const canSave = dirty && (!isNeutralRecipe(present) || edited)
  const statusCount = editState?.usage.statusCount ?? 0

  // ---- Changes -----------------------------------------------------------

  const change = useCallback(
    (next: Recipe, coalesceKey?: string) => {
      setAutoStatus(null)
      history.set(next, { coalesceKey })
    },
    [history]
  )

  const onAdjust = useCallback(
    (key: AdjustmentKey, value: number) =>
      change(setAdjustment(present, key, value), key),
    [change, present]
  )

  const onGeometryChange = useCallback(
    (geometry: Geometry, coalesceKey?: string) =>
      change(withGeometry(present, geometry), coalesceKey),
    [change, present]
  )

  const onCropChange = useCallback(
    (crop: CropRect) => onGeometryChange({ ...present.geometry, crop }, 'crop'),
    [onGeometryChange, present.geometry]
  )

  const onResetGroups = useCallback(
    (groups: ControlGroup[]) => {
      const adjustments = { ...present.adjustments }
      for (const control of controlsIn(...groups))
        delete adjustments[control.key]
      change({ ...present, adjustments })
    },
    [change, present]
  )

  const onAuto = useCallback(() => {
    const stats = renderer.getAutoStats()
    if (!stats) return
    const auto = computeAuto(stats)
    const adjustments = { ...present.adjustments }
    for (const key of AUTO_KEYS) delete adjustments[key]
    let count = 0
    for (const key of AUTO_KEYS) {
      if (auto[key] !== 0) {
        adjustments[key] = auto[key]
        count += 1
      }
    }
    history.set({ ...present, adjustments })
    setAutoStatus(describeAuto(count))
    setAnnouncement(
      `Auto applied ${count} ${count === 1 ? 'change' : 'changes'}`
    )
  }, [history, present, renderer])

  const setComparing = useCallback((next: boolean) => {
    setComparingState((current) => {
      if (current !== next) {
        setAnnouncement(next ? 'Showing original' : 'Showing edit')
      }
      return next
    })
  }, [])

  const onUndo = useCallback(() => {
    setAutoStatus(null)
    history.undo()
  }, [history])
  const onRedo = useCallback(() => {
    setAutoStatus(null)
    history.redo()
  }, [history])

  // ---- Saving ------------------------------------------------------------

  const runSave = useCallback(
    async (applyToPosts?: ApplyToPosts) => {
      if (!editState || !bitmapRef.current) return
      setPhase('saving')
      setFailure(null)
      const saveId = crypto.randomUUID()
      const baseVersion = editState.edit.version
      try {
        let result: MediaEditSaveResult
        if (revertsToOriginal) {
          result = await withNetworkRetry(() =>
            revertMediaEdit(mediaId, { baseVersion, saveId, applyToPosts })
          )
        } else {
          const recipe = normalizeRecipe(present)
          const blob = await exportRecipe(bitmapRef.current, recipe)
          result = await withNetworkRetry(() =>
            saveMediaEdit(mediaId, {
              blob,
              recipe,
              baseVersion,
              saveId,
              applyToPosts
            })
          )
        }
        onSaved(result.media, result.posts ?? NO_POSTS)
      } catch (error) {
        if (isOwnSave(error, saveId)) {
          // The first attempt landed and only its answer was lost.
          try {
            const fresh = await getMediaEdit(mediaId)
            onSaved(fresh.media, NO_POSTS)
            return
          } catch (refetchError) {
            setFailure(describeEditError(refetchError))
            setPhase('ready')
            return
          }
        }
        setFailure(describeEditError(error))
        setPhase('ready')
      }
    },
    [editState, mediaId, onSaved, present, revertsToOriginal]
  )

  const onSave = useCallback(() => {
    if (!ready || !canSave) return
    if (statusCount > 0) setPromptOpen(true)
    else void runSave(undefined)
  }, [canSave, ready, runSave, statusCount])

  const requestCancel = useCallback(() => {
    if (saving) return
    if (dirty) setDiscardOpen(true)
    else onClose()
  }, [dirty, onClose, saving])

  const reload = useCallback(() => {
    setFailure(null)
    setPhase('loading')
    setBitmap(null)
    setLoadVersion((value) => value + 1)
  }, [])

  const dialogsOpen = promptOpen || discardOpen || reloadOpen
  useEditorShortcuts(ready && !dialogsOpen, {
    undo: onUndo,
    redo: onRedo,
    save: onSave,
    setComparing
  })

  // ---- Layout ------------------------------------------------------------

  const controls = useMemo<EditorControls | null>(
    () =>
      editState
        ? {
            recipe: present,
            source: {
              width: editState.edit.source.width,
              height: editState.edit.source.height
            },
            disabled: !ready,
            onAdjust,
            onGestureStart: history.beginGesture,
            onGestureEnd: history.endGesture,
            onResetGroups,
            onAuto,
            autoStatus,
            onGeometryChange
          }
        : null,
    [
      editState,
      present,
      ready,
      onAdjust,
      history.beginGesture,
      history.endGesture,
      onResetGroups,
      onAuto,
      autoStatus,
      onGeometryChange
    ]
  )

  const alerts = failure ? (
    <Alert
      title={failure.message}
      action={
        failure.reload ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (dirty ? setReloadOpen(true) : reload())}
          >
            Reload
          </Button>
        ) : undefined
      }
    />
  ) : null

  const onCategoryChange = (category: ControlGroup) => {
    setPhoneCategory(category)
    setSelectedControl(controlsIn(category)[0].key)
  }

  const body = (() => {
    if (phase === 'loading') {
      return (
        <div className="flex flex-1 items-center justify-center bg-photo-stage">
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">Loading photo</span>
        </div>
      )
    }
    if (phase === 'error') {
      return (
        <div className="flex-1 p-4 md:p-6">
          <Alert
            title={
              tooLarge
                ? 'This photo is too large to edit in the browser.'
                : (loadError ?? "Couldn't load the photo.")
            }
            onRetry={tooLarge ? undefined : reload}
          />
        </div>
      )
    }
    if (!controls) return null
    return (
      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[1fr_292px]">
        <EditorStage
          containerRef={containerRef}
          canvasRef={canvasRef}
          canvasKey={renderer.canvasKey}
          bitmap={bitmap}
          box={renderer.box}
          css={renderer.css}
          status={renderer.status}
          tab={tab}
          comparing={comparing}
          geometry={present.geometry}
          orientedSize={renderer.orientedSize}
          disabled={saving}
          announcement={announcement}
          onCropChange={onCropChange}
          onGestureStart={history.beginGesture}
          onGestureEnd={history.endGesture}
          onRetry={renderer.retry}
        />
        {isDesktop ? (
          <EditorPanel
            controls={controls}
            histogram={renderer.histogram}
            details={details}
            alerts={alerts}
          />
        ) : (
          <EditorPhoneControls
            controls={controls}
            category={phoneCategory}
            selected={
              controlsIn(phoneCategory).some((c) => c.key === selectedControl)
                ? selectedControl
                : CONTROLS_BY_KEY[controlsIn(phoneCategory)[0].key].key
            }
            onCategoryChange={onCategoryChange}
            onSelect={setSelectedControl}
            alerts={alerts}
          />
        )}
      </div>
    )
  })()

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestCancel()
        }}
      >
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          aria-busy={saving}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            if (!dialogsOpen) requestCancel()
          }}
          onInteractOutside={(event) => event.preventDefault()}
          className="inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-background p-0 sm:max-w-none dark:bg-background motion-reduce:animate-none"
        >
          <Tabs
            value={tab}
            onValueChange={(next) => setTab(next as EditorTab)}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <EditorTopBar
              canUndo={history.canUndo}
              canRedo={history.canRedo}
              comparing={comparing}
              saving={saving}
              saveDisabled={!ready || !canSave}
              controlsDisabled={!ready}
              onCancel={requestCancel}
              onUndo={onUndo}
              onRedo={onRedo}
              onComparingChange={setComparing}
              onSave={onSave}
            />
            {body}
          </Tabs>
        </DialogContent>
      </Dialog>

      <SavePrompt
        open={promptOpen}
        count={statusCount}
        latestStatusAt={editState?.usage.latestStatusAt ?? null}
        onKeepEditing={() => setPromptOpen(false)}
        onSave={(choice) => {
          setPromptOpen(false)
          void runSave(choice)
        }}
      />
      <ConfirmDialog
        open={discardOpen}
        title="Discard your edits?"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        destructive
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false)
          onClose()
        }}
      />
      <ConfirmDialog
        open={reloadOpen}
        title="Discard your edits?"
        description="Reloading brings back the photo as it is now."
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        destructive
        onCancel={() => setReloadOpen(false)}
        onConfirm={() => {
          setReloadOpen(false)
          reload()
        }}
      />
    </>
  )
}

export default PhotoEditorDialog
