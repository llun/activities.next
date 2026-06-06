'use client'

import { Ban, Check, EyeOff, Trash2, Upload } from 'lucide-react'
import { ChangeEvent, FC, FormEvent, useRef, useState } from 'react'

import {
  adminCreateCustomEmoji,
  adminDeleteCustomEmoji,
  adminUpdateCustomEmoji
} from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
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
      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-green-500/40 bg-green-500/5 px-4 py-3 text-sm text-green-700 dark:text-green-300">
          {notice}
        </div>
      ) : null}

      {/* Upload form — mirrors the design system's "Add a sticker" section. */}
      <section className="rounded-xl border bg-background/80 p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Add a custom emoji</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Upload a PNG or JPEG and give it a shortcode. People type it between
          colons in a post, e.g. <span className="font-mono">:blobcheer:</span>.
        </p>
        <form
          onSubmit={onSubmit}
          className="grid items-start gap-4 sm:grid-cols-[auto_1fr]"
        >
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Choose emoji image"
              className="flex size-24 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Upload className="size-6" />
            </button>
            <span className="max-w-24 truncate text-[11px] text-muted-foreground">
              {file ? file.name : 'PNG or JPEG'}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={onFileChange}
            />
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="emoji-shortcode">Shortcode</Label>
              <Input
                id="emoji-shortcode"
                value={shortcode}
                onChange={(event) => setShortcode(event.target.value)}
                placeholder="e.g. blobcheer"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and underscores. People type it as
                :shortcode:
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="emoji-category">Category (optional)</Label>
              <Input
                id="emoji-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="e.g. cats"
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={submitting}>
              <Upload className="size-4" />
              {submitting ? 'Uploading…' : 'Upload emoji'}
            </Button>
          </div>
        </form>
      </section>

      {/* Existing emoji list — mirrors the design system's sticker list rows. */}
      <section className="rounded-xl border bg-background/80 p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Custom emojis</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {emojis.length} uploaded.
        </p>
        {emojis.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No custom emoji uploaded yet.
          </p>
        ) : (
          <div className="space-y-2">
            {emojis.map((emoji) => (
              <div
                key={emoji.id}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center',
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
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Disabled
                      </span>
                    ) : null}
                    {!emoji.visible_in_picker ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Hidden from picker
                      </span>
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
                    <EyeOff className="size-4" />
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
                    {emoji.disabled ? (
                      <Check className="size-4" />
                    ) : (
                      <Ban className="size-4" />
                    )}
                    {emoji.disabled ? 'Enable' : 'Disable'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Delete :${emoji.shortcode}:`}
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onDelete(emoji)}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
