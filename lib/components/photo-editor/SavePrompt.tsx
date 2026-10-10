'use client'

import { format } from 'date-fns/format'
import { useState } from 'react'

import type { ApplyToPosts } from '@/lib/client/mediaEdit'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Label } from '@/lib/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'

interface Props {
  open: boolean
  /** How many posts use the photo. */
  count: number
  /** When the newest of them was written (ISO 8601). */
  latestStatusAt: string | null
  onKeepEditing: () => void
  onSave: (choice: ApplyToPosts) => void
}

const describePosts = (count: number, latestStatusAt: string | null) => {
  const latest = latestStatusAt ? new Date(latestStatusAt) : null
  const dated = latest && !Number.isNaN(latest.getTime())
  const where =
    count === 1
      ? `This photo is in 1 post${dated ? ` from ${format(latest, 'd MMM')}` : ''}.`
      : `This photo is in ${count} posts.`
  return `${where} Your original stays on your account, and you can revert later.`
}

const Body = ({
  count,
  latestStatusAt,
  onKeepEditing,
  onSave
}: Omit<Props, 'open'>) => {
  const [choice, setChoice] = useState<ApplyToPosts>('update')
  const plural = count !== 1
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {plural ? 'Update the posts too?' : 'Update the post too?'}
        </DialogTitle>
        <DialogDescription>
          {describePosts(count, latestStatusAt)}
        </DialogDescription>
      </DialogHeader>
      <RadioGroup
        value={choice}
        onValueChange={(value) => setChoice(value as ApplyToPosts)}
        aria-label="What to do with the posts"
        className="space-y-1"
      >
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <RadioGroupItem
            value="update"
            id="photo-edit-update"
            className="mt-1"
          />
          <div className="space-y-1">
            <Label htmlFor="photo-edit-update" className="font-medium">
              {plural ? 'Update the posts' : 'Update the post'}
            </Label>
            <p className="text-sm text-muted-foreground">
              Followers&apos; servers get an edit with the new photo.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <RadioGroupItem
            value="gallery"
            id="photo-edit-gallery"
            className="mt-1"
          />
          <div className="space-y-1">
            <Label htmlFor="photo-edit-gallery" className="font-medium">
              Gallery only
            </Label>
            <p className="text-sm text-muted-foreground">
              {plural
                ? 'The posts keep the photo as it was.'
                : 'The post keeps the photo as it was.'}
            </p>
          </div>
        </div>
      </RadioGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onKeepEditing}>
          Keep editing
        </Button>
        <Button type="button" onClick={() => onSave(choice)}>
          Save
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * Asked once, when the photo is already in posts: send an edit to followers
 * ("Update the post") or change the Gallery only.
 */
export const SavePrompt = ({ open, onKeepEditing, ...rest }: Props) => (
  <Dialog
    open={open}
    onOpenChange={(next) => (next ? undefined : onKeepEditing())}
  >
    <DialogContent
      showCloseButton={false}
      className="motion-reduce:animate-none"
    >
      {/* Mounted only while open, so the choice starts at "Update" each time. */}
      {open ? <Body {...rest} onKeepEditing={onKeepEditing} /> : null}
    </DialogContent>
  </Dialog>
)
