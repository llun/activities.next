'use client'

import { FC, FormEvent, useEffect, useState } from 'react'

import { createFitnessGear, updateFitnessGear } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'
import {
  type FitnessGearKind,
  type SportKey,
  getSportKeysForKind,
  getSportLabel
} from '@/lib/services/fitness-files/sportTypes'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'

import { BIKE_TYPE_OPTIONS } from './gearUi'

interface Props {
  open: boolean
  kind: FitnessGearKind
  /** Present in edit mode; the dialog creates a new gear when it is null. */
  gear?: GearEntity | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

// Running shoes are retired somewhere in this band; 650 km is the middle of it
// and the value the design system pre-selects.
const ALERT_DISTANCE_KM_OPTIONS = [500, 550, 600, 650, 700, 750, 800]
const DEFAULT_ALERT_DISTANCE_KM = 650

const joinBrandModel = (brand: string, model: string): string =>
  [brand.trim(), model.trim()].filter(Boolean).join(' ')

const getFallbackName = (kind: FitnessGearKind): string => {
  if (kind === 'bike') return 'New bike'
  return kind === 'device' ? 'New device' : 'New shoes'
}

export const GearFormDialog: FC<Props> = ({
  open,
  kind,
  gear = null,
  onOpenChange,
  onSaved
}) => {
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [nickname, setNickname] = useState('')
  const [bikeType, setBikeType] = useState('')
  const [weight, setWeight] = useState('')
  const [defaultSports, setDefaultSports] = useState<SportKey[]>([])
  const [isAlertEnabled, setIsAlertEnabled] = useState(false)
  const [alertDistanceKm, setAlertDistanceKm] = useState(
    DEFAULT_ALERT_DISTANCE_KM
  )
  const [productUrl, setProductUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the fields whenever the dialog opens so a cancelled edit never leaks
  // into the next one, and an "Add" that follows an "Edit" starts empty.
  useEffect(() => {
    if (!open) return

    const nextBrand = gear?.brand ?? ''
    const nextModel = gear?.model ?? ''
    setBrand(nextBrand)
    setModel(nextModel)
    // A name that is exactly "brand model" was derived rather than typed, so it
    // stays derived — otherwise editing the brand would leave the old stale
    // combination pinned in the nickname field.
    setNickname(
      gear && gear.name !== joinBrandModel(nextBrand, nextModel)
        ? gear.name
        : ''
    )
    setBikeType(gear?.bikeType ?? '')
    setWeight(
      gear?.weightKilograms === null || gear?.weightKilograms === undefined
        ? ''
        : String(gear.weightKilograms)
    )
    setDefaultSports((gear?.defaultSports ?? []) as SportKey[])
    setIsAlertEnabled(Boolean(gear?.alertDistanceMeters))
    setAlertDistanceKm(
      gear?.alertDistanceMeters
        ? Math.round(gear.alertDistanceMeters / 1000)
        : DEFAULT_ALERT_DISTANCE_KM
    )
    setProductUrl(gear?.productUrl ?? '')
    setNotes(gear?.notes ?? '')
    setError(null)
  }, [open, gear])

  const isBike = kind === 'bike'
  // A device is never created here — the import resolves it from the file's own
  // recorded identity — so the dialog only ever edits one, and it edits the four
  // display fields. Sending anything else (a sport, an alert, a frame type) is a
  // 422 from the API, so the shape is decided here rather than left to whatever
  // the last kind's state was.
  const isDevice = kind === 'device'
  const isEditing = Boolean(gear)
  const title = isDevice
    ? 'Edit device'
    : isEditing
      ? isBike
        ? 'Edit bike'
        : 'Edit shoes'
      : isBike
        ? 'Add a bike'
        : 'Add shoes'
  const submitLabel = isEditing
    ? 'Save changes'
    : isBike
      ? 'Save bike'
      : 'Save shoes'

  const toggleSport = (sportKey: SportKey) => {
    setDefaultSports((current) =>
      current.includes(sportKey)
        ? current.filter((key) => key !== sportKey)
        : [...current, sportKey]
    )
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSaving(true)

    const parsedWeight = Number.parseFloat(weight)
    // Bikes may carry bikeType/weight but never an alert distance; shoes are the
    // mirror image. Sending the wrong pair is a 422 from the API, so the shape
    // is decided here rather than left to whatever the last kind's state was.
    const payload = isDevice
      ? {
          name:
            nickname.trim() ||
            joinBrandModel(brand, model) ||
            getFallbackName(kind),
          brand: brand.trim() || null,
          model: model.trim() || null,
          productUrl: productUrl.trim() || null
        }
      : {
          name:
            nickname.trim() ||
            joinBrandModel(brand, model) ||
            getFallbackName(kind),
          brand: brand.trim() || null,
          model: model.trim() || null,
          bikeType: isBike ? bikeType || null : null,
          weightKilograms:
            isBike && Number.isFinite(parsedWeight) && parsedWeight > 0
              ? parsedWeight
              : null,
          defaultSports,
          alertDistanceMeters:
            !isBike && isAlertEnabled ? alertDistanceKm * 1000 : null,
          notes: notes.trim() || null
        }

    try {
      if (gear) {
        await updateFitnessGear(gear.id, payload)
      } else if (!isDevice) {
        await createFitnessGear({ kind, ...payload })
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
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gear-brand">Brand</Label>
              <Input
                id="gear-brand"
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gear-model">Model</Label>
              <Input
                id="gear-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gear-nickname">Nickname</Label>
            <Input
              id="gear-nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground">
              Shown everywhere instead of brand and model.
            </p>
          </div>

          {isDevice && (
            <div className="space-y-1.5">
              <Label htmlFor="gear-product-url">Product page</Label>
              <Input
                id="gear-product-url"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={productUrl}
                onChange={(event) => setProductUrl(event.target.value)}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">
                Linked from this device&apos;s page. Starts as the
                manufacturer&apos;s site; point it at the product if you like.
              </p>
            </div>
          )}

          {isBike && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="gear-bike-type">Type</Label>
                <Select
                  id="gear-bike-type"
                  value={bikeType}
                  onChange={(event) => setBikeType(event.target.value)}
                  disabled={isSaving}
                >
                  <option value="">Not set</option>
                  {BIKE_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gear-weight">Weight (kg)</Label>
                <Input
                  id="gear-weight"
                  type="number"
                  min="0"
                  step="0.1"
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                  disabled={isSaving}
                />
              </div>
            </div>
          )}

          {!isDevice && (
            <div className="space-y-1.5">
              <Label>Default sports</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {getSportKeysForKind(kind).map((sportKey) => (
                  <Label
                    key={sportKey}
                    htmlFor={`gear-sport-${sportKey}`}
                    className="font-normal"
                  >
                    <Checkbox
                      id={`gear-sport-${sportKey}`}
                      checked={defaultSports.includes(sportKey)}
                      onChange={() => toggleSport(sportKey)}
                      disabled={isSaving}
                    />
                    {getSportLabel(sportKey)}
                  </Label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                New activities of these types are assigned to this gear
                automatically. One gear per sport — picking a sport moves it off
                the gear that had it.
              </p>
            </div>
          )}

          {kind === 'shoes' && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="gear-alert-enabled">Distance alert</Label>
                <Switch
                  id="gear-alert-enabled"
                  checked={isAlertEnabled}
                  onCheckedChange={setIsAlertEnabled}
                  disabled={isSaving}
                />
              </div>
              {isAlertEnabled && (
                <div className="space-y-1.5">
                  <Label htmlFor="gear-alert-distance">Alert at</Label>
                  <Select
                    id="gear-alert-distance"
                    value={String(alertDistanceKm)}
                    onChange={(event) =>
                      setAlertDistanceKm(Number(event.target.value))
                    }
                    disabled={isSaving}
                  >
                    {ALERT_DISTANCE_KM_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option} km
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Most running shoes wear out between 500 and 800 km. You&apos;ll
                get a notification and an email when the pair passes the mark.
              </p>
            </div>
          )}

          {!isDevice && (
            <div className="space-y-1.5">
              <Label htmlFor="gear-notes">Notes</Label>
              <Textarea
                id="gear-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={isSaving}
              />
            </div>
          )}

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
