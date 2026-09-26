'use client'

import { FC, FormEvent, useEffect, useState } from 'react'

import {
  COMPONENT_TYPE_OPTIONS,
  formatKmInt
} from '@/app/(timeline)/fitness/gear/gearUi'
import {
  createFitnessGearComponent,
  updateFitnessGearComponent
} from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import type { GearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'

interface Props {
  open: boolean
  gearId: string
  component?: GearComponentEntity | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

const SERVICE_REMINDER_KM_OPTIONS = [1000, 3000, 5000, 8000, 12000]

type AddedMode = 'beginning' | 'date'

const formatIsoDate = (timestamp: number | null | undefined): string => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0]
}

export const GearComponentFormDialog: FC<Props> = ({
  open,
  gearId,
  component = null,
  onOpenChange,
  onSaved
}) => {
  const isEditing = Boolean(component)
  const [componentType, setComponentType] = useState<string>(
    COMPONENT_TYPE_OPTIONS[0]
  )
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [addedMode, setAddedMode] = useState<AddedMode>('beginning')
  const [addedDate, setAddedDate] = useState('')
  const [serviceKm, setServiceKm] = useState('')
  const [productUrl, setProductUrl] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    if (component) {
      setComponentType(component.componentType)
      setBrand(component.brand ?? '')
      setModel(component.model ?? '')
      setAddedMode(component.addedAt ? 'date' : 'beginning')
      setAddedDate(formatIsoDate(component.addedAt))
      setServiceKm(
        component.serviceDistanceMeters
          ? String(Math.round(component.serviceDistanceMeters / 1000))
          : ''
      )
      setProductUrl(component.productUrl ?? '')
    } else {
      setComponentType(COMPONENT_TYPE_OPTIONS[0])
      setBrand('')
      setModel('')
      setAddedMode('beginning')
      setAddedDate('')
      setServiceKm('')
      setProductUrl('')
    }
    setError(null)
  }, [open, component])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSaving(true)

    if (addedMode === 'date' && !addedDate) {
      setError('Please select an added date.')
      setIsSaving(false)
      return
    }

    const addedAtMs =
      addedMode === 'date' && addedDate
        ? new Date(addedDate).getTime()
        : undefined

    try {
      if (isEditing && component) {
        await updateFitnessGearComponent(gearId, component.id, {
          componentType,
          brand: brand.trim() || null,
          model: model.trim() || null,
          addedAt:
            addedMode === 'beginning'
              ? null
              : Number.isFinite(addedAtMs)
                ? addedAtMs
                : undefined,
          serviceDistanceMeters: serviceKm ? Number(serviceKm) * 1000 : null,
          productUrl: productUrl.trim() || null
        })
      } else {
        await createFitnessGearComponent(gearId, {
          componentType,
          brand: brand.trim() || null,
          model: model.trim() || null,
          addedAt: Number.isFinite(addedAtMs) ? addedAtMs : undefined,
          serviceDistanceMeters: serviceKm ? Number(serviceKm) * 1000 : null,
          productUrl: productUrl.trim() || null
        })
      }
      onOpenChange(false)
      onSaved()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save component.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const title = isEditing ? 'Edit component' : 'Add a component'
  const submitLabel = isEditing ? 'Save changes' : 'Save component'

  const typeOptions =
    componentType &&
    !(COMPONENT_TYPE_OPTIONS as readonly string[]).includes(componentType)
      ? [componentType, ...COMPONENT_TYPE_OPTIONS]
      : COMPONENT_TYPE_OPTIONS

  const serviceKmNum = serviceKm ? Number(serviceKm) : null
  const serviceReminderOptions =
    serviceKmNum && !SERVICE_REMINDER_KM_OPTIONS.includes(serviceKmNum)
      ? [...SERVICE_REMINDER_KM_OPTIONS, serviceKmNum].sort((a, b) => a - b)
      : SERVICE_REMINDER_KM_OPTIONS

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSaving) {
          onOpenChange(nextOpen)
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing
              ? 'Edit component details such as brand, model, install date, and service reminders.'
              : 'Add a new component with brand, model, install date, and service reminders.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          aria-label={isEditing ? 'Edit component' : 'Add component'}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="component-type">Component type</Label>
            <Select
              id="component-type"
              value={componentType}
              onChange={(event) => setComponentType(event.target.value)}
              disabled={isSaving}
            >
              {typeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="component-brand">Brand</Label>
              <Input
                id="component-brand"
                maxLength={255}
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="component-model">Model</Label>
              <Input
                id="component-model"
                maxLength={255}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="component-added">Added on</Label>
              <Select
                id="component-added"
                value={addedMode}
                onChange={(event) =>
                  setAddedMode(event.target.value as AddedMode)
                }
                disabled={isSaving}
              >
                <option value="beginning">Since beginning</option>
                <option value="date">Specify date</option>
              </Select>
              {addedMode === 'date' && (
                <Input
                  type="date"
                  aria-label="Added date"
                  required
                  value={addedDate}
                  onChange={(event) => setAddedDate(event.target.value)}
                  disabled={isSaving}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Distance counts from this date.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="component-service">Service reminder</Label>
              <Select
                id="component-service"
                value={serviceKm}
                onChange={(event) => setServiceKm(event.target.value)}
                disabled={isSaving}
              >
                <option value="">No reminder</option>
                {serviceReminderOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatKmInt(option * 1000)}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional — notify at this distance.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="component-product-url">Product page</Label>
            <Input
              id="component-product-url"
              type="url"
              inputMode="url"
              placeholder="https://"
              maxLength={255}
              value={productUrl}
              onChange={(event) => setProductUrl(event.target.value)}
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground">
              Optional link to the manufacturer&apos;s product page.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

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
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
