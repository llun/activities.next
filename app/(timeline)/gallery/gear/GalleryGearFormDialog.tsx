'use client'

import { FC, FormEvent, useEffect, useState } from 'react'

import { createGalleryGear, updateGalleryGear } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import type { GalleryGearEntity } from '@/lib/services/gallery/galleryEntities'
import type { GalleryGearKind } from '@/lib/types/database/gallery'

interface Props {
  open: boolean
  kind: GalleryGearKind
  /** Present in edit mode; the dialog creates a new gear when it is null. */
  gear?: GalleryGearEntity | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

const joinBrandModel = (brand: string, model: string): string =>
  [brand.trim(), model.trim()].filter(Boolean).join(' ')

export const GalleryGearFormDialog: FC<Props> = ({
  open,
  kind,
  gear = null,
  onOpenChange,
  onSaved
}) => {
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [productUrl, setProductUrl] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the fields whenever the dialog opens so a cancelled edit never leaks
  // into the next one, and an "Add" that follows an "Edit" starts empty.
  useEffect(() => {
    if (!open) return
    setName(gear?.name ?? '')
    setBrand(gear?.brand ?? '')
    setModel(gear?.model ?? '')
    setProductUrl(gear?.productUrl ?? '')
    setError(null)
  }, [open, gear])

  const isEditing = Boolean(gear)
  const noun = kind === 'camera' ? 'camera' : 'lens'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const resolvedName = name.trim() || joinBrandModel(brand, model)
    if (!resolvedName) {
      setError(`Give the ${noun} a name.`)
      return
    }

    setError(null)
    setIsSaving(true)
    const fields = {
      name: resolvedName,
      brand: brand.trim() || null,
      model: model.trim() || null,
      productUrl: productUrl.trim() || null
    }

    try {
      if (gear) {
        await updateGalleryGear(gear.id, fields)
      } else {
        await createGalleryGear({ kind, ...fields })
      }
      onSaved()
      onOpenChange(false)
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Failed to save gear.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? `Edit ${noun}` : `Add a ${noun}`}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gallery-gear-name">Name</Label>
            <Input
              id="gallery-gear-name"
              value={name}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground">
              Shown everywhere instead of brand and model. Leave it empty to use
              both.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gallery-gear-brand">Brand</Label>
              <Input
                id="gallery-gear-brand"
                value={brand}
                maxLength={255}
                onChange={(event) => setBrand(event.target.value)}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gallery-gear-model">Model</Label>
              <Input
                id="gallery-gear-model"
                value={model}
                maxLength={255}
                onChange={(event) => setModel(event.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gallery-gear-product-url">Product page</Label>
            <Input
              id="gallery-gear-product-url"
              type="url"
              inputMode="url"
              placeholder="https://"
              // The column is varchar(255); a longer value would come back as
              // a bare "Unprocessable entity", so it stops at the input.
              maxLength={255}
              value={productUrl}
              onChange={(event) => setProductUrl(event.target.value)}
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground">
              Optional link to the manufacturer&apos;s product page.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isEditing ? 'Save changes' : `Save ${noun}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
