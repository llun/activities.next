'use client'

import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { FC, useId, useRef, useState } from 'react'

import { useInstanceLimits } from '@/lib/components/instance-limits'
import { uploadProfileImage } from '@/lib/components/settings/uploadProfileImage'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { Textarea } from '@/lib/components/ui/textarea'
import { ACCEPTED_IMAGE_TYPES } from '@/lib/services/medias/constants'

import { DESCRIPTION_MAX_LENGTH } from './profileDraft'

interface Props {
  kind: 'avatar' | 'header'
  /** The image the draft holds, or null for none. */
  url: string | null
  alt: string
  /** The letter shown on the avatar while it has no image. */
  initial: string
  /** The save's message for the image itself (a rejected URL). */
  imageError?: string | null
  /** The save's message for the alt text (too long). */
  altError?: string | null
  onUrlChange: (url: string | null) => void
  onAltChange: (alt: string) => void
  /** Tells the page when a file is being uploaded, so it can hold Save back. */
  onUploadingChange?: (uploading: boolean) => void
}

const COPY = {
  avatar: {
    label: 'Avatar',
    hint: 'Shown next to your name everywhere.',
    change: 'Change avatar',
    remove: 'Remove avatar',
    altButton: 'Avatar alt text',
    altLabel: 'Avatar alt text'
  },
  header: {
    label: 'Header image',
    hint: 'The picture across the top of your profile.',
    change: 'Change header',
    remove: 'Remove header',
    altButton: 'Alt text',
    altLabel: 'Header alt text'
  }
} as const

/**
 * One profile picture in the Photos box: a preview, Change (a file picker, the
 * same upload the composer uses), Remove, and the alt text behind its own
 * button. Uploading puts the new media URL in the editor's draft; nothing is
 * saved until the page's Save, and the file stays unattached until then.
 */
export const ProfileImageField: FC<Props> = ({
  kind,
  url,
  alt,
  initial,
  imageError,
  altError,
  onUrlChange,
  onAltChange,
  onUploadingChange
}) => {
  const copy = COPY[kind]
  const { maxMediaFileSize } = useInstanceLimits()
  const id = useId()
  const changeId = `${id}-change`
  const altId = `${id}-alt`
  const imageErrorId = `${id}-image-error`
  const altErrorId = `${id}-alt-error`
  const fileInputRef = useRef<HTMLInputElement>(null)
  const changeButtonRef = useRef<HTMLButtonElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [altOpen, setAltOpen] = useState(alt !== '' || Boolean(altError))
  // An alt text error that arrives with the panel shut opens it, so the message
  // and the field it is about can be seen (and focused).
  const [seenAltError, setSeenAltError] = useState(altError)
  if (altError !== seenAltError) {
    setSeenAltError(altError)
    if (altError) setAltOpen(true)
  }
  const shownImageError = uploadError ?? imageError ?? null

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setUploadError(null)
    setUploading(true)
    onUploadingChange?.(true)
    const result = await uploadProfileImage(file, maxMediaFileSize)
    setUploading(false)
    onUploadingChange?.(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (result.error !== undefined) {
      setUploadError(result.error)
      return
    }
    onUrlChange(result.url)
  }

  return (
    <FormRow label={copy.label} hint={copy.hint}>
      {({ labelledBy }) => (
        <div role="group" aria-labelledby={labelledBy} className="space-y-3">
          {kind === 'header' ? (
            <div
              data-slot="profile-image-preview"
              role="img"
              aria-label={url ? 'Current header image' : 'No header image'}
              className="bg-muted h-28 w-full rounded-md bg-cover bg-center"
              style={url ? { backgroundImage: `url("${url}")` } : undefined}
            />
          ) : (
            <Avatar
              data-slot="profile-image-preview"
              className="size-20 border"
            >
              {url ? <AvatarImage src={url} alt="" /> : null}
              <AvatarFallback className="text-[34px]">{initial}</AvatarFallback>
            </Avatar>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={changeButtonRef}
              id={changeId}
              data-focus-target={
                kind === 'avatar' ? 'iconUrl' : 'headerImageUrl'
              }
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              aria-describedby={shownImageError ? imageErrorId : undefined}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <ImagePlus aria-hidden="true" />
              )}
              {uploading ? 'Uploading…' : copy.change}
            </Button>
            {url ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading}
                aria-label={copy.remove}
                onClick={() => {
                  // Remove unmounts with the image, so hand focus on first.
                  changeButtonRef.current?.focus()
                  setUploadError(null)
                  onUrlChange(null)
                }}
              >
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={altOpen}
              aria-controls={altId}
              onClick={() => setAltOpen((open) => !open)}
            >
              {copy.altButton}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => handleFile(event.currentTarget.files?.[0])}
            />
          </div>

          {shownImageError ? (
            <p
              id={imageErrorId}
              role="alert"
              className="text-destructive-text text-xs"
            >
              {shownImageError}
            </p>
          ) : null}

          <div id={altId} hidden={!altOpen}>
            <Textarea
              rows={2}
              data-focus-target={
                kind === 'avatar' ? 'avatarDescription' : 'headerDescription'
              }
              value={alt}
              maxLength={DESCRIPTION_MAX_LENGTH}
              aria-label={copy.altLabel}
              aria-invalid={altError ? true : undefined}
              aria-describedby={altError ? altErrorId : undefined}
              placeholder="Describe the picture for people who can’t see it"
              onChange={(event) => onAltChange(event.target.value)}
            />
            {altError ? (
              <p
                id={altErrorId}
                role="alert"
                className="text-destructive-text mt-1 text-xs"
              >
                {altError}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </FormRow>
  )
}
