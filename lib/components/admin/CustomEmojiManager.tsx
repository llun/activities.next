'use client'

import { Ban, Check, EyeOff, Trash2, Upload } from 'lucide-react'
import { ChangeEvent, FC, FormEvent, useRef, useState } from 'react'

import {
  adminCreateCustomEmoji,
  adminDeleteCustomEmoji,
  adminUpdateCustomEmoji
} from '@/lib/client'
import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import type { AdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import { CUSTOM_EMOJI_SHORTCODE_REGEX } from '@/lib/types/domain/customEmoji'
import { cn } from '@/lib/utils'

interface Props {
  initialEmojis: AdminCustomEmoji[]
}

const sortByShortcode = (emojis: AdminCustomEmoji[]) =>
  [...emojis].sort((a, b) => a.shortcode.localeCompare(b.shortcode))

export const CustomEmojiManager: FC<Props> = ({ initialEmojis }) => {
  const [emojis, setEmojis] = useState<AdminCustomEmoji[]>(
    sortByShortcode(initialEmojis)
  )
  const [shortcode, setShortcode] = useState('')
  const [category, setCategory] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null)
  }

  const resetForm = () => {
    setShortcode('')
    setCategory('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (!file) {
      setError('Choose an image to upload.')
      return
    }
    if (!CUSTOM_EMOJI_SHORTCODE_REGEX.test(shortcode)) {
      setError('Shortcode may contain only letters, numbers, and underscores.')
      return
    }

    setSubmitting(true)
    try {
      const created = await adminCreateCustomEmoji({
        shortcode,
        image: file,
        category: category.trim() || undefined
      })
      setEmojis((current) => sortByShortcode([...current, created]))
      setNotice(`Added :${created.shortcode}:`)
      resetForm()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed')
    } finally {
      setSubmitting(false)
    }
  }

  const applyUpdate = async (
    id: string,
    patch: Parameters<typeof adminUpdateCustomEmoji>[0]
  ) => {
    setError(null)
    setNotice(null)
    try {
      const updated = await adminUpdateCustomEmoji(patch)
      setEmojis((current) =>
        sortByShortcode(
          current.map((emoji) => (emoji.id === id ? updated : emoji))
        )
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Update failed')
    }
  }

  const onDelete = async (emoji: AdminCustomEmoji) => {
    setError(null)
    setNotice(null)
    try {
      await adminDeleteCustomEmoji(emoji.id)
      setEmojis((current) => current.filter((item) => item.id !== emoji.id))
      setNotice(`Deleted :${emoji.shortcode}:`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delete failed')
    }
  }

  return (
    <div className="space-y-6">
      {error ? <Alert title={error} /> : null}
      {notice ? <Alert tone="success" title={notice} /> : null}

      {/* Upload form — mirrors the design system's "Add a sticker" section. */}
      <Section
        title="Add a custom emoji"
        description={
          <>
            Upload a PNG or JPEG and give it a shortcode. People type it between
            colons in a post, e.g.{' '}
            <span className="font-mono">:blobcheer:</span>.
          </>
        }
      >
        <form onSubmit={onSubmit}>
          <Frame
            divided
            footer={
              <div className="flex justify-end">
                <Button type="submit" disabled={submitting}>
                  <Upload />
                  {submitting ? 'Uploading…' : 'Upload emoji'}
                </Button>
              </div>
            }
          >
            <FormRow
              label="Image"
              htmlFor="emoji-image"
              hint={file ? file.name : 'PNG or JPEG'}
              inline
            >
              <button
                id="emoji-image"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Choose emoji image"
                className="border-input text-muted-foreground hover:border-primary hover:text-primary focus-visible:ring-ring flex size-16 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <Upload className="size-5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={onFileChange}
              />
            </FormRow>
            <FormRow
              label="Shortcode"
              htmlFor="emoji-shortcode"
              hint="Lowercase letters, numbers, and underscores. People type it as :shortcode:"
            >
              {({ describedBy }) => (
                <Input
                  id="emoji-shortcode"
                  value={shortcode}
                  onChange={(event) => setShortcode(event.target.value)}
                  placeholder="e.g. blobcheer"
                  autoComplete="off"
                  aria-describedby={describedBy}
                />
              )}
            </FormRow>
            <FormRow label="Category (optional)" htmlFor="emoji-category">
              <Input
                id="emoji-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="e.g. cats"
                autoComplete="off"
              />
            </FormRow>
          </Frame>
        </form>
      </Section>

      {/* Existing emoji list — mirrors the design system's sticker list rows. */}
      <Section title="Custom emojis" meta={`${emojis.length} uploaded`}>
        {emojis.length === 0 ? (
          <EmptyState
            icon={ADMIN_ICONS.emojis}
            title="No custom emoji uploaded yet."
          >
            Emoji you upload above show up here.
          </EmptyState>
        ) : (
          <FramedList aria-label="Custom emojis">
            {emojis.map((emoji) => (
              <FramedListItem
                key={emoji.id}
                className={cn(
                  'flex flex-col gap-3 sm:flex-row sm:items-center',
                  emoji.disabled && 'opacity-60'
                )}
              >
                <img
                  src={emoji.static_url}
                  alt={`:${emoji.shortcode}:`}
                  className="size-10 shrink-0 object-contain"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="font-mono">:{emoji.shortcode}:</span>
                    {emoji.disabled ? (
                      <Badge tone="gray">Disabled</Badge>
                    ) : null}
                    {!emoji.visible_in_picker ? (
                      <Badge tone="gray">Hidden from picker</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1">
                    <Input
                      aria-label={`Category for :${emoji.shortcode}:`}
                      defaultValue={emoji.category ?? ''}
                      placeholder="No category"
                      className="h-8 w-full max-w-56 text-xs"
                      onBlur={(event) => {
                        const next = event.target.value.trim() || null
                        if (next === (emoji.category ?? null)) return
                        applyUpdate(emoji.id, { id: emoji.id, category: next })
                      }}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      applyUpdate(emoji.id, {
                        id: emoji.id,
                        visibleInPicker: !emoji.visible_in_picker
                      })
                    }
                  >
                    <EyeOff />
                    {emoji.visible_in_picker ? 'Hide' : 'Show'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      applyUpdate(emoji.id, {
                        id: emoji.id,
                        disabled: !emoji.disabled
                      })
                    }
                  >
                    {emoji.disabled ? <Check /> : <Ban />}
                    {emoji.disabled ? 'Enable' : 'Disable'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Delete :${emoji.shortcode}:`}
                    className="border-destructive/40 text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                    onClick={() => onDelete(emoji)}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              </FramedListItem>
            ))}
          </FramedList>
        )}
      </Section>
    </div>
  )
}
