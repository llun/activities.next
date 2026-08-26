'use client'

import { Loader2, Upload, X } from 'lucide-react'
import { FC, SyntheticEvent, useRef, useState } from 'react'

import { uploadAttachment } from '@/lib/client'
import { useInstanceLimits } from '@/lib/components/instance-limits'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_HEIGHT,
  MAX_WIDTH
} from '@/lib/services/medias/constants'
import { formatFileSize } from '@/lib/utils/formatFileSize'
import { resizeImage } from '@/lib/utils/resizeImage'

interface ImageUploadFieldProps {
  fieldName: 'iconUrl' | 'headerImageUrl'
  currentUrl: string | null
  label: string
  previewType: 'thumbnail' | 'landscape'
}

export const ImageUploadField: FC<ImageUploadFieldProps> = ({
  fieldName,
  currentUrl,
  label,
  previewType
}) => {
  // The instance's configured upload cap (admin setting media.maxFileSize), so
  // this pre-check agrees with what the upload endpoint will actually accept.
  const { maxMediaFileSize } = useInstanceLimits()
  const [imageUrl, setImageUrl] = useState<string>(currentUrl || '')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadButtonRef = useRef<HTMLButtonElement>(null)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleRemoveClick = () => {
    // Hand focus to Upload BEFORE clearing. Remove is rendered only while a
    // value is set, so clearing unmounts the button that was just activated —
    // and a focused element removed from the document drops focus to `<body>`,
    // sending the next Tab back to the top of the page (WCAG 2.4.3). The
    // media strip's chevrons have the same shape and are documented in
    // AGENTS.md; their fix (leave the control out of the tab order) does not
    // apply here, because Remove is the only way to clear the image.
    uploadButtonRef.current?.focus()
    // Submitting an empty value is how both profile routes are told to clear
    // the stored image.
    setImageUrl('')
    setUploadError(null)
  }

  const handleFileSelect = async (
    event: SyntheticEvent<HTMLInputElement, Event>
  ) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return

    // Reset error state
    setUploadError(null)

    // Validate file type
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError('Please select a JPEG or PNG image')
      // Reset file input to allow re-selection
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }

    try {
      setIsUploading(true)

      // Resize image
      const resizedFile = await resizeImage(file, MAX_WIDTH, MAX_HEIGHT)

      // Validate the size of what is actually uploaded. Checking the original
      // would reject a large photo that resizing brings comfortably under a
      // lowered cap.
      if (resizedFile.size > maxMediaFileSize) {
        // The enclosing finally clears the uploading flag and the file input.
        setUploadError(
          `Image is too large. Maximum size is ${formatFileSize(maxMediaFileSize)}`
        )
        return
      }

      // Upload file
      const result = await uploadAttachment(resizedFile)

      if (!result) {
        setUploadError('Failed to upload image. Please try again.')
        return
      }

      // Update image URL with uploaded URL
      setImageUrl(result.url)
    } catch {
      setUploadError('Failed to upload image. Please try again.')
    } finally {
      setIsUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const previewClassName =
    previewType === 'thumbnail'
      ? 'w-20 h-20 rounded-full'
      : 'w-full h-32 rounded-md'

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldName}>{label}</Label>

      {/* Preview */}
      {imageUrl && (
        <div
          className={`relative ${previewClassName} bg-cover bg-center cursor-pointer transition-opacity`}
          style={{ backgroundImage: `url("${imageUrl}")` }}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          onClick={handleUploadClick}
        >
          {isHovering && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-[inherit]">
              <span className="text-white text-sm font-medium">Change</span>
            </div>
          )}
        </div>
      )}

      {/* The field is read-only because the routes behind it only accept a URL
          naming media this instance already stores, which is exactly what the
          upload button produces. A typeable box would invite a remote URL that
          the server refuses. */}
      <div className="flex gap-2">
        <Input
          type="text"
          id={fieldName}
          value={imageUrl}
          readOnly
          placeholder="No image uploaded yet"
          // `Input` styles `disabled` but not `readOnly`, so without a muted
          // surface this reads as a typeable box sitting under Name and
          // Summary, which are. It stays `readOnly` rather than `disabled`
          // because the preview above is a background-image `div` that
          // assistive tech cannot see — this field is the only announced
          // representation of which image is set, and `disabled` would drop it
          // from the tab order.
          className="flex-1 bg-muted"
        />
        <Button
          ref={uploadButtonRef}
          type="button"
          variant="outline"
          size="icon"
          onClick={handleUploadClick}
          disabled={isUploading}
          aria-label={isUploading ? `Uploading ${label}` : `Upload ${label}`}
        >
          {isUploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
        </Button>
        {imageUrl && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleRemoveClick}
            disabled={isUploading}
            aria-label={`Remove ${label}`}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Hidden input for form submission */}
      <input type="hidden" name={fieldName} value={imageUrl} />

      {/* Error message */}
      {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
    </div>
  )
}
