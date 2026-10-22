'use client'

import { AlertTriangle } from 'lucide-react'
import {
  FC,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useReducer,
  useRef,
  useState
} from 'react'

import { createNote, uploadAttachment } from '@/lib/client'
import { reportRequestFailure } from '@/lib/client/connection'
import type { DraftRecord } from '@/lib/client/drafts'
import { DRAFT_LOCKED_NOTICE, classifyFailedPost } from '@/lib/client/http'
import { useInstanceLimits } from '@/lib/components/instance-limits'
import { DraftSaveStatus } from '@/lib/components/post-box/DraftSaveStatus'
import {
  addAttachment,
  createDefaultState,
  loadExtension,
  resetExtension,
  setAttachments,
  setContentWarning,
  setContentWarningVisibility,
  statusExtensionReducer,
  updateAttachment
} from '@/lib/components/post-box/reducers'
import { UploadMediaButton } from '@/lib/components/post-box/upload-media-button'
import {
  DRAFT_CONFLICT_SEND_NOTICE,
  DRAFT_NOT_SAVED_SEND_NOTICE,
  type DraftContent,
  fromDraftAttachment,
  loadDraftFiles,
  toDraftAttachment,
  useComposerDraft
} from '@/lib/components/post-box/useComposerDraft'
import { ActorInfo } from '@/lib/components/posts/actor'
import { ReplyTargetContent } from '@/lib/components/posts/reply-target-content'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { useAutoResizeTextarea } from '@/lib/hooks/useAutoResizeTextarea'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment, PostBoxAttachment } from '@/lib/types/domain/attachment'
import { Status, getOriginalStatus } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { generatePublicId } from '@/lib/utils/publicId'

import {
  PreparedReplyDraft,
  ReplyMentionMode,
  ReplyTargetPreview,
  prepareReplyDraft
} from './replyDraft'

interface Props {
  profile: ActorProfile
  replyStatus: Status
  isMediaUploadEnabled?: boolean
  onCancel: () => void
  onPostCreated: (status: Status, attachments: Attachment[]) => void
  /** A saved draft to reopen: seeds the reply box on its first run. */
  draft?: DraftRecord
  /** Drafts page only: an emptied draft stays saved until the editor closes. */
  keepWhenEmpty?: boolean
}

export const StatusReplyBox: FC<Props> = ({
  profile,
  replyStatus,
  isMediaUploadEnabled,
  onCancel,
  onPostCreated,
  draft,
  keepWhenEmpty
}) => {
  // The instance's configured status length (admin setting posts.maxCharacters).
  // The reply endpoint enforces it too, so without this the reply box would let
  // a draft grow past the limit and only fail on submit.
  const { maxStatusCharacters, maxMediaAttachments } = useInstanceLimits()
  const [isPosting, setIsPosting] = useState<boolean>(false)
  const [text, setText] = useState<string>('')
  const [warningMsg, setWarningMsg] = useState<string | null>(null)
  // Set once the server kept the reply (503/409): the draft is locked so Post
  // retries the same payload under the same Idempotency-Key. Any edit would
  // mint a new key and strand the kept reply (or duplicate it).
  const [lockedMessage, setLockedMessageState] = useState<string | null>(null)
  const draftLocked = lockedMessage !== null
  // Written with the lock, not after render: a media batch that settles
  // between the two must already see it.
  const draftLockedRef = useRef(draftLocked)
  const setLockedMessage = (message: string | null) => {
    draftLockedRef.current = message !== null
    setLockedMessageState(message)
  }
  // Bumped when the reply target changes: a submit still in flight belongs to
  // the previous draft and must not lock the new one.
  const draftGenerationRef = useRef(0)
  const [mentionMode, setMentionMode] = useState<ReplyMentionMode>('all')
  const [targetPreview, setTargetPreview] = useState<ReplyTargetPreview | null>(
    null
  )
  const [inheritedVisibility, setInheritedVisibility] =
    useState<MastodonVisibility>('public')
  const [inheritedLanguage, setInheritedLanguage] = useState<
    string | undefined
  >(undefined)
  const [mentionsSummary, setMentionsSummary] = useState<
    PreparedReplyDraft['mentions']
  >({
    author: null,
    others: [],
    all: []
  })

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useAutoResizeTextarea(textareaRef, text)
  const formRef = useRef<HTMLFormElement>(null)
  const isSubmittingRef = useRef<boolean>(false)
  const submitIdempotencyRef = useRef<{
    fingerprint: string
    key: string
  } | null>(null)
  const initializedStatusIdRef = useRef<string | null>(null)
  const userHasEditedTextRef = useRef<boolean>(false)

  const [postExtension, dispatch] = useReducer(
    statusExtensionReducer,
    undefined,
    createDefaultState
  )
  const postExtensionRef = useRef(postExtension)
  const removedAttachmentIdsRef = useRef<Set<string>>(new Set())

  // On-device draft. The mention pre-fill is not the author's text, so it
  // alone never makes a draft.
  const textRef = useRef(text)
  textRef.current = text
  const initialTextRef = useRef('')
  const draftSeededRef = useRef(false)
  // Uploaded media id -> the local id the draft knows the attachment by.
  const localIdByIdRef = useRef(new Map<string, string>())
  // Media the server kept with a post: a draft never owns (or deletes) it.
  const keptIdsRef = useRef(new Set<string>())
  const inheritedRef = useRef<{
    visibility: MastodonVisibility
    language?: string
  }>({ visibility: 'public' })
  inheritedRef.current = {
    visibility: inheritedVisibility,
    language: inheritedLanguage
  }

  // True while a reopened draft's attachment bytes are loading.
  const draftSeedingRef = useRef(false)

  const getDraftContent = (force = false): DraftContent | null => {
    const extension = postExtensionRef.current
    const value = textRef.current
    const attachments = extension.attachments.map((attachment) =>
      toDraftAttachment(attachment, {
        localIds: localIdByIdRef.current,
        isOwned: (mediaId) => !keptIdsRef.current.has(mediaId)
      })
    )
    const worthKeeping =
      (value.trim() !== '' && value !== initialTextRef.current) ||
      attachments.some((attachment) => attachment.owned)
    // A locked draft stays until it is discarded, whatever it holds.
    if (!worthKeeping && !force && !draftLockedRef.current) return null
    return {
      text: value,
      contentWarning: extension.contentWarning,
      contentWarningVisible: extension.contentWarningVisible,
      visibility: inheritedRef.current.visibility,
      quoteApprovalPolicy: extension.quoteApprovalPolicy,
      language: inheritedRef.current.language,
      attachments
    }
  }

  const composerDraft = useComposerDraft({
    composer: 'reply-box',
    replyTo: replyStatus,
    draft,
    keepWhenEmpty,
    isSeeding: () => draftSeedingRef.current,
    getContent: getDraftContent,
    // The draft this composer let go of keeps its key; new content gets its own.
    onUnlock: () => {
      submitIdempotencyRef.current = null
      // The block belonged to the draft this composer let go of.
      setWarningMsg(null)
    }
  })

  useEffect(() => {
    postExtensionRef.current = postExtension
  }, [postExtension])

  useEffect(() => {
    composerDraft.schedule()
    // schedule is stable and reads the composer through refs.
  }, [text, postExtension, lockedMessage])

  // Allow posting if text has content OR if there are media attachments
  // (permitting valid attachment-only replies per repository guidelines).
  const hasContent =
    text.trim().length > 0 || postExtension.attachments.length > 0
  // A locked draft replays server-side before any content-limit check, so a
  // lowered limit must not block its retry.
  const allowPost =
    hasContent && (draftLocked || text.length <= maxStatusCharacters)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      postExtensionRef.current.attachments.forEach((attachment) => {
        if (attachment.url.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.url)
        }
        if (attachment.posterUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.posterUrl)
        }
      })
    }
  }, [])

  // Puts a reopened draft back in the box. Uploaded attachments are used as
  // they are (the submit fingerprint, and so its key, stay the same); the ones
  // that never uploaded are rebuilt from the kept bytes and upload on Post.
  const seedFromDraft = (seed: DraftRecord) => {
    const apply = (files: Awaited<ReturnType<typeof loadDraftFiles>>) => {
      const attachments: PostBoxAttachment[] = []
      for (const item of seed.attachments) {
        const restored = fromDraftAttachment(item, files)
        // Neither the server nor the device has it: nothing to restore.
        if (!restored) continue
        attachments.push(restored)
        if (item.mediaId) {
          localIdByIdRef.current.set(item.mediaId, item.localId)
          if (!item.owned) keptIdsRef.current.add(item.mediaId)
        }
      }
      const nextExtension = {
        ...createDefaultState(),
        attachments,
        contentWarning: seed.contentWarning,
        contentWarningVisible: seed.contentWarningVisible,
        quoteApprovalPolicy: seed.quoteApprovalPolicy
      }
      postExtensionRef.current = nextExtension
      dispatch(loadExtension(nextExtension))
      userHasEditedTextRef.current = true
      setInheritedVisibility(seed.visibility)
      setInheritedLanguage(seed.language)
      textRef.current = seed.text
      setText(seed.text)
      submitIdempotencyRef.current = seed.submit ?? null
      setLockedMessage(seed.lockedMessage ?? null)
    }
    if (!seed.attachments.some((item) => !item.mediaId)) {
      apply(new Map())
      return
    }
    draftSeedingRef.current = true
    void loadDraftFiles(seed).then((files) => {
      draftSeedingRef.current = false
      if (mountedRef.current) apply(files)
    })
  }

  // Initialize draft helper: compute mentions, CW, visibility, declared language,
  // and target preview. Do NOT overwrite an edited draft when unrelated status props refresh.
  useEffect(() => {
    if (initializedStatusIdRef.current === replyStatus.id) {
      return
    }

    const seeded = Boolean(draft) && !draftSeededRef.current
    // Re-targeted: the previous target's draft stays where it was saved.
    // A send in flight keeps its own draft too.
    if (!seeded && (composerDraft.hasDraft() || isSubmittingRef.current)) {
      void composerDraft.detach()
      // Its attachments stay with it: the new target starts without them.
      dispatch(resetExtension())
      removedAttachmentIdsRef.current.clear()
    }
    initializedStatusIdRef.current = replyStatus.id
    userHasEditedTextRef.current = false
    draftGenerationRef.current += 1
    setLockedMessage(null)

    const prepared = prepareReplyDraft({
      targetStatus: replyStatus,
      currentViewer: profile,
      mentionMode
    })

    setTargetPreview(prepared.targetPreview)
    setInheritedVisibility(prepared.visibility)
    setInheritedLanguage(prepared.language)
    setMentionsSummary(prepared.mentions)
    initialTextRef.current = prepared.initialText

    setText(prepared.initialText)
    if (prepared.isSpoilerVisible) {
      dispatch(setContentWarningVisibility(true))
      dispatch(setContentWarning(prepared.spoilerText))
    } else {
      dispatch(setContentWarningVisibility(false))
      dispatch(setContentWarning(''))
    }

    if (seeded && draft) {
      draftSeededRef.current = true
      seedFromDraft(draft)
    }

    const cursor = seeded && draft ? draft.text.length : prepared.cursorPosition
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = cursor
        textareaRef.current.selectionEnd = cursor
        textareaRef.current.focus()
      }
    }, 0)
  }, [profile, replyStatus, mentionMode])

  const handleMentionModeChange = (mode: ReplyMentionMode) => {
    setMentionMode(mode)
    if (!userHasEditedTextRef.current) {
      const prepared = prepareReplyDraft({
        targetStatus: replyStatus,
        currentViewer: profile,
        mentionMode: mode
      })
      initialTextRef.current = prepared.initialText
      setText(prepared.initialText)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = prepared.cursorPosition
          textareaRef.current.selectionEnd = prepared.cursorPosition
          textareaRef.current.focus()
        }
      }, 0)
    }
  }

  const onPost = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()

    // Double-submit prevention: synchronously reject if already submitting
    if (isSubmittingRef.current || isPosting) {
      return
    }
    isSubmittingRef.current = true
    const generation = draftGenerationRef.current
    const retryingLockedDraft = draftLocked
    setIsPosting(true)
    setWarningMsg(null)
    removedAttachmentIdsRef.current.clear()

    const message = text
    const contentWarning = postExtension.contentWarningVisible
      ? postExtension.contentWarning
      : undefined

    try {
      const uploadResults = await Promise.all(
        postExtension.attachments.map(async (attachment) => {
          if (!attachment.file)
            return {
              originalId: attachment.id,
              uploadedAttachment: attachment
            }

          dispatch(
            updateAttachment(attachment.id, {
              ...attachment,
              isLoading: true
            })
          )

          try {
            const uploaded = attachment.posterFile
              ? await uploadAttachment(attachment.file, attachment.posterFile)
              : await uploadAttachment(attachment.file)
            if (!uploaded) throw new Error()

            if (attachment.url.startsWith('blob:')) {
              URL.revokeObjectURL(attachment.url)
            }
            if (attachment.posterUrl?.startsWith('blob:')) {
              URL.revokeObjectURL(attachment.posterUrl)
            }

            localIdByIdRef.current.set(
              uploaded.id,
              localIdByIdRef.current.get(attachment.id) ?? attachment.id
            )
            const newAttachment = {
              ...attachment,
              ...uploaded,
              isLoading: false,
              file: undefined,
              posterFile: undefined
            }
            dispatch(updateAttachment(attachment.id, newAttachment))
            return {
              originalId: attachment.id,
              uploadedAttachment: newAttachment
            }
          } catch {
            dispatch(
              updateAttachment(attachment.id, {
                ...attachment,
                isLoading: false
              })
            )
            throw new Error(
              `Fail to upload ${attachment.file?.name ?? attachment.name ?? 'file'}`
            )
          }
        })
      )

      // Re-targeted while uploading: the draft stays in Drafts as the box left
      // it, and nothing is sent or written to the new target's composer.
      // If it could not be kept, the not-saved note offers its text; with no
      // drafts at all, the send goes ahead with what it uploaded.
      const retargeted = generation !== draftGenerationRef.current
      if (retargeted && (await composerDraft.leftBehind()) !== 'none') {
        isSubmittingRef.current = false
        setIsPosting(false)
        return
      }

      // Removed while uploading: left out. After a re-target the box holds the
      // new target's attachments, so only the uploads themselves count.
      const currentAttachmentIds = new Set(
        postExtensionRef.current.attachments.map((a) => a.id)
      )
      const removedAttachmentIds = removedAttachmentIdsRef.current
      const attachments = uploadResults
        .filter(
          (a) =>
            retargeted ||
            (!removedAttachmentIds.has(a.originalId) &&
              !removedAttachmentIds.has(a.uploadedAttachment.id) &&
              (currentAttachmentIds.has(a.originalId) ||
                currentAttachmentIds.has(a.uploadedAttachment.id)))
        )
        .map((a) => a.uploadedAttachment)

      if (!retargeted) {
        // The draft reads the ref, which only follows a render.
        postExtensionRef.current = {
          ...postExtensionRef.current,
          attachments
        }
      }

      const replyFingerprint = JSON.stringify({
        message,
        contentWarning: contentWarning ?? null,
        inReplyToId: replyStatus.id,
        visibility: inheritedVisibility,
        language: inheritedLanguage ?? null,
        attachmentIds: attachments.map((attachment) => attachment.id)
      })
      if (submitIdempotencyRef.current?.fingerprint !== replyFingerprint) {
        submitIdempotencyRef.current = {
          fingerprint: replyFingerprint,
          key: generatePublicId()
        }
      }

      // The key and the attempt are written to the draft before the POST. If
      // that write fails nothing is sent: a lost response plus a lost key would
      // send the same reply again under a new key after a reload.
      if (!(await composerDraft.recordAttempt(submitIdempotencyRef.current))) {
        setWarningMsg(
          composerDraft.isConflicted()
            ? DRAFT_CONFLICT_SEND_NOTICE
            : DRAFT_NOT_SAVED_SEND_NOTICE
        )
        isSubmittingRef.current = false
        setIsPosting(false)
        return
      }

      const response = await createNote({
        message,
        contentWarning,
        replyStatus,
        inReplyToId: replyStatus.id,
        visibility: inheritedVisibility,
        language: inheritedLanguage,
        attachments,
        idempotencyKey: submitIdempotencyRef.current.key
      })

      submitIdempotencyRef.current = null
      setLockedMessage(null)
      const { status, attachments: storedAttachments } = response
      // The posted reply owns the media now: drop the draft and its bytes only.
      void composerDraft.release()
      onPostCreated(status, storedAttachments)
      // Re-targeted mid-send: the box now holds the new target's draft.
      if (generation === draftGenerationRef.current) {
        dispatch(resetExtension())
        removedAttachmentIdsRef.current.clear()
        setText('')
      }
      isSubmittingRef.current = false
      setIsPosting(false)
    } catch (error) {
      isSubmittingRef.current = false
      setIsPosting(false)
      reportRequestFailure(error)
      // Surface the server's message without wiping user draft, CW, or attachments.
      const { action, message: failureMessage } = classifyFailedPost(error, {
        retryingLocked: retryingLockedDraft,
        fallbackMessage: 'Fail to create a reply',
        wayOut: 'cancel the reply'
      })
      // A stale failure belongs to a previous draft: say nothing on this one.
      // The draft left behind takes the lock (a reopen must retry under the
      // same key).
      if (generation !== draftGenerationRef.current) {
        void composerDraft.leftBehind()
        if (action !== 'none') {
          void composerDraft.recordSentLock(
            action === 'lock' ? failureMessage : null
          )
        }
        return
      }
      if (action === 'lock') {
        setLockedMessage(failureMessage)
        // The server keeps the reply and the media it uses.
        postExtensionRef.current.attachments.forEach((attachment) => {
          if (!attachment.file) keptIdsRef.current.add(attachment.id)
        })
        // Persist the key and the lock: a reopened draft must retry under the
        // same key, or it duplicates the reply the server kept.
        void composerDraft.recordLock(
          failureMessage,
          submitIdempotencyRef.current
        )
      } else {
        setWarningMsg(failureMessage)
        if (action === 'unlock') {
          // Nothing is kept under this key any more: let the draft be edited
          // again under a new key instead of stranding it.
          setLockedMessage(null)
          submitIdempotencyRef.current = null
          void composerDraft.recordLock(null, null)
        }
      }
    }
  }

  // Cancel on a locked draft discards it and its key. The reply box never
  // deletes uploaded media, so the kept reply's media stays.
  const onCancelReply = () => {
    // A submit in flight owns the key: closing now would lose its result.
    if (isSubmittingRef.current) return
    // Text worth keeping stays in Drafts (and says so); a locked or empty
    // reply is dropped.
    if (!draftLocked && getDraftContent() !== null) void composerDraft.keep()
    else void composerDraft.discard()
    if (draftLocked) {
      draftGenerationRef.current += 1
      submitIdempotencyRef.current = null
      setLockedMessage(null)
      setWarningMsg(null)
      setText('')
      postExtensionRef.current = createDefaultState()
      dispatch(resetExtension())
    }
    onCancel()
  }

  const onRemoveAttachment = (attachmentIndex: number) => {
    if (draftLocked) return
    const attachment = postExtension.attachments[attachmentIndex]
    if (!attachment) return

    removedAttachmentIdsRef.current.add(attachment.id)

    if (attachment.url.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.url)
    }
    if (attachment.posterUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.posterUrl)
    }

    const nextAttachments = [
      ...postExtension.attachments.slice(0, attachmentIndex),
      ...postExtension.attachments.slice(attachmentIndex + 1)
    ]

    postExtensionRef.current = {
      ...postExtensionRef.current,
      attachments: nextAttachments
    }

    dispatch(setAttachments(nextAttachments))
  }

  const onQuickPost = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.code !== 'Enter') return
    if (!allowPost || isSubmittingRef.current || isPosting) return
    if (!formRef.current) return
    event.preventDefault()
    await onPost()
  }

  const onTextChange = (value: string) => {
    userHasEditedTextRef.current = true
    setText(value)
  }

  const actualReplyStatus = getOriginalStatus(replyStatus)

  const getPlaceholder = () => {
    if (targetPreview) {
      return `Reply to ${targetPreview.authorName}...`
    }
    return 'Reply...'
  }

  return (
    <div className="mt-4 pt-4 border-t border-border/40">
      {targetPreview ? (
        <div
          data-testid="reply-target-preview"
          className="mb-3 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs"
        >
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <span className="shrink-0 font-medium">Replying to</span>
            <div className="min-w-0 flex-1 text-sm text-foreground">
              <ActorInfo
                actor={actualReplyStatus.actor}
                actorId={actualReplyStatus.actorId || ''}
              />
            </div>
            {targetPreview.isPoll ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary-text font-semibold">
                Poll
              </span>
            ) : null}
          </div>
          {targetPreview.spoilerText ? (
            <div className="mt-1 font-medium text-warning-text">
              CW: {targetPreview.spoilerText}
            </div>
          ) : null}
          <ReplyTargetContent
            host={profile.domain}
            status={replyStatus}
            className="mt-1"
          />
        </div>
      ) : null}

      {mentionsSummary.others.length > 0 ? (
        <div className="flex items-center gap-1.5 mb-2.5 text-xs text-muted-foreground">
          <span className="text-[11px] font-medium mr-1">Mentions:</span>
          <button
            type="button"
            onClick={() => handleMentionModeChange('all')}
            disabled={draftLocked}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              mentionMode === 'all'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'bg-muted hover:bg-muted/80 text-foreground'
            )}
          >
            All ({mentionsSummary.all.length})
          </button>
          <button
            type="button"
            onClick={() => handleMentionModeChange('author-first')}
            disabled={draftLocked}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              mentionMode === 'author-first'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'bg-muted hover:bg-muted/80 text-foreground'
            )}
          >
            Author first
          </button>
          <button
            type="button"
            onClick={() => handleMentionModeChange('author-only')}
            disabled={draftLocked}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              mentionMode === 'author-only'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'bg-muted hover:bg-muted/80 text-foreground'
            )}
          >
            Author only
          </button>
        </div>
      ) : null}

      <form ref={formRef} onSubmit={onPost}>
        <div className="flex items-start gap-3">
          <Avatar className="size-8 shrink-0">
            <AvatarImage
              src={profile.iconUrl}
              alt={profile.name ?? profile.username}
            />
            <AvatarFallback className="text-xs">
              {(profile.name ?? profile.username).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              className="flex min-h-[60px] max-h-[min(320px,40dvh)] w-full resize-none bg-transparent text-base placeholder:text-muted-foreground focus-visible:outline-none field-sizing-content overflow-y-auto md:text-sm"
              rows={2}
              onKeyDown={onQuickPost}
              onChange={(e) => onTextChange(e.target.value)}
              name="message"
              placeholder={getPlaceholder()}
              value={text}
              readOnly={draftLocked}
            />

            {postExtension.contentWarningVisible ? (
              <input
                type="text"
                className="mt-2 flex h-8 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Content warning"
                name="contentWarning"
                placeholder="Write your warning here"
                value={postExtension.contentWarning}
                readOnly={draftLocked}
                onChange={(event) =>
                  dispatch(setContentWarning(event.target.value))
                }
              />
            ) : null}

            {postExtension.attachments.length > 0 && (
              <div className="grid gap-2 grid-cols-8 mt-2">
                {postExtension.attachments.map((item, index) => (
                  <div
                    className={cn(
                      'w-full aspect-square bg-border bg-center bg-cover relative rounded',
                      draftLocked ? 'cursor-default' : 'cursor-pointer'
                    )}
                    inert={draftLocked}
                    key={item.id}
                    style={{
                      backgroundImage: `url("${item.posterUrl || item.url}")`
                    }}
                    onClick={() => onRemoveAttachment(index)}
                  >
                    {item.isLoading ? (
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 overflow-hidden rounded opacity-70"
                      >
                        <SkeletonBar className="h-full rounded-none" />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-2 empty:hidden">
              <DraftSaveStatus
                saveState={composerDraft.saveState}
                text={text}
              />
            </div>

            {warningMsg ? (
              <div role="alert" className="text-xs text-destructive-text mt-2">
                {warningMsg}
              </div>
            ) : null}

            {lockedMessage ? (
              <div role="status" className="text-xs text-muted-foreground mt-2">
                {lockedMessage} {DRAFT_LOCKED_NOTICE}
              </div>
            ) : null}

            <div className="flex items-center mt-2">
              <Button
                type="button"
                variant={
                  postExtension.contentWarningVisible ? 'secondary' : 'link'
                }
                size="icon-sm"
                aria-label={
                  postExtension.contentWarningVisible
                    ? 'Remove content warning'
                    : 'Add content warning'
                }
                title="Content warning"
                disabled={draftLocked}
                onClick={() =>
                  dispatch(
                    setContentWarningVisibility(
                      !postExtension.contentWarningVisible
                    )
                  )
                }
              >
                <AlertTriangle className="size-4" />
              </Button>
              <UploadMediaButton
                isMediaUploadEnabled={isMediaUploadEnabled}
                attachments={postExtension.attachments}
                disabled={isPosting || draftLocked}
                onAddAttachment={(attachment) => {
                  // A batch that settles after submit began or the draft
                  // locked would change the retried payload, and its key.
                  if (
                    isSubmittingRef.current ||
                    draftLockedRef.current ||
                    postExtensionRef.current.attachments.length >=
                      maxMediaAttachments
                  ) {
                    if (attachment.url.startsWith('blob:')) {
                      URL.revokeObjectURL(attachment.url)
                    }
                    if (attachment.posterUrl?.startsWith('blob:')) {
                      URL.revokeObjectURL(attachment.posterUrl)
                    }
                    return
                  }
                  postExtensionRef.current = {
                    ...postExtensionRef.current,
                    attachments: [
                      ...postExtensionRef.current.attachments,
                      attachment
                    ]
                  }
                  dispatch(addAttachment(attachment, maxMediaAttachments))
                  if (attachment.file) {
                    composerDraft.attachBlob(
                      attachment.id,
                      attachment.file,
                      attachment.posterFile
                    )
                  }
                }}
                onDuplicateError={() =>
                  setWarningMsg('Some files are already selected')
                }
                onFilesRejected={(message) => setWarningMsg(message)}
                onUploadStart={() => setWarningMsg(null)}
              />
              <div className="flex items-center gap-2 ml-auto">
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    !draftLocked && text.length > maxStatusCharacters
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  )}
                >
                  {maxStatusCharacters - text.length}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPosting}
                  onClick={onCancelReply}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!allowPost || isPosting}
                  type="submit"
                  size="sm"
                >
                  {isPosting ? 'Posting…' : 'Post'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
