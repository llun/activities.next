'use client'

import { Loader2, Upload } from 'lucide-react'
import { FC, SyntheticEvent, useRef, useState } from 'react'

import { uploadAttachment } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_FILE_SIZE,
  MAX_HEIGHT,
  MAX_WIDTH
} from '@/lib/services/medias/constants'
import { resizeImage } from '@/lib/utils/resizeImage'

interface ImageUploadFieldProps {
  fieldName: 'iconUrl' | 'headerImageUrl'
  currentUrl: string | null
  label: string
  placeholder: string
  previewType: 'thumbnail' | 'landscape'
}

export const ImageUploadField: FC<ImageUploadFieldProps> = ({
  fieldName,
  currentUrl,
  label,
  placeholder,
  previewType
}) => {
  const [imageUrl, setImageUrl] = useState<string>(currentUrl || '')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
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

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setUploadError('Image is too large. Maximum size is 200MB')
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

      // Upload file
      const result = await uploadAttachment(resizedFile)

      if (!result) {
        setUploadError('Failed to upload image. Please try again.')
        return
      }

      // Update image URL with uploaded URL
      setImageUrl(result.url)
    } catch (error) {
      console.error('Upload error:', error)
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

      {/* Input field with upload button */}
      <div className="flex gap-2">
        <Input
          type="text"
          id={fieldName}
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleUploadClick}
          disabled={isUploading}
        >
          {isUploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
        </Button>
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
