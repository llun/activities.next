'use client'

import { FC, FormEvent, useState } from 'react'

import { updateFitnessGeneralSettings } from '@/lib/client'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import {
  DEFAULT_HEART_RATE_ZONES,
  FUNCTIONAL_THRESHOLD_POWER_RANGE,
  MAX_HEART_RATE_RANGE,
  RESTING_HEART_RATE_RANGE,
  type TrainingZoneDefinition,
  type TrainingZoneSettings,
  formatZoneRange,
  getHeartRateZones,
  getPowerZones
} from '@/lib/fitness/trainingZones'

interface Props {
  initialZones: TrainingZoneSettings | null
}

interface FieldValues {
  maxHeartRate: string
  restingHeartRate: string
  functionalThresholdPower: string
}

const toFieldValues = (zones: TrainingZoneSettings | null): FieldValues => ({
  maxHeartRate: zones?.maxHeartRate?.toString() ?? '',
  restingHeartRate: zones?.restingHeartRate?.toString() ?? '',
  functionalThresholdPower: zones?.functionalThresholdPower?.toString() ?? ''
})

/** An empty field is null; anything else must be a whole number in range. */
const parseField = (
  text: string,
  range: { min: number; max: number }
): number | null | undefined => {
  const trimmed = text.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= range.min && value <= range.max
    ? value
    : undefined
}

const ZonePreview: FC<{
  label: string
  zones: TrainingZoneDefinition[]
  unit: string
}> = ({ label, zones, unit }) => (
  <ul aria-label={label} className="space-y-1.5 text-sm tabular-nums">
    {zones.map((zone) => (
      <li
        key={zone.name}
        className="grid grid-cols-[12px_28px_minmax(0,1fr)_auto] items-center gap-x-2"
      >
        <span
          aria-hidden="true"
          className="size-3 rounded-full"
          style={{ background: zone.color }}
        />
        <span className="font-semibold">{zone.name}</span>
        <span className="truncate text-muted-foreground">{zone.label}</span>
        <span className="whitespace-nowrap">{formatZoneRange(zone, unit)}</span>
      </li>
    ))}
  </ul>
)

/**
 * Fitness → Zones: the athlete's max and resting heart rate and FTP, with a
 * live preview of the zones they give. Saved together to the general fitness
 * settings; an empty field clears its value.
 */
export const FitnessTrainingZonesSettings: FC<Props> = ({ initialZones }) => {
  const [values, setValues] = useState(() => toFieldValues(initialZones))
  // What the server holds now, for Reset and for knowing what is unsaved.
  const [savedValues, setSavedValues] = useState(values)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const maxHeartRate = parseField(values.maxHeartRate, MAX_HEART_RATE_RANGE)
  const restingHeartRate = parseField(
    values.restingHeartRate,
    RESTING_HEART_RATE_RANGE
  )
  const functionalThresholdPower = parseField(
    values.functionalThresholdPower,
    FUNCTIONAL_THRESHOLD_POWER_RANGE
  )

  const invalidReason =
    maxHeartRate === undefined
      ? `Max heart rate must be ${MAX_HEART_RATE_RANGE.min}–${MAX_HEART_RATE_RANGE.max} bpm`
      : restingHeartRate === undefined
        ? `Resting heart rate must be ${RESTING_HEART_RATE_RANGE.min}–${RESTING_HEART_RATE_RANGE.max} bpm`
        : maxHeartRate !== null &&
            restingHeartRate !== null &&
            restingHeartRate >= maxHeartRate
          ? 'Resting heart rate must be below max heart rate'
          : functionalThresholdPower === undefined
            ? `Functional threshold power must be ${FUNCTIONAL_THRESHOLD_POWER_RANGE.min}–${FUNCTIONAL_THRESHOLD_POWER_RANGE.max} W`
            : undefined

  // The preview follows what is typed while it is valid, and the defaults
  // while there is no usable max heart rate.
  const heartRateZones =
    getHeartRateZones({
      maxHeartRate: maxHeartRate ?? null,
      restingHeartRate: restingHeartRate ?? null
    }) ?? DEFAULT_HEART_RATE_ZONES
  const isDefaultHeartRateZones = !maxHeartRate
  const powerZones = getPowerZones({
    functionalThresholdPower: functionalThresholdPower ?? null
  })

  const dirty =
    values.maxHeartRate.trim() !== savedValues.maxHeartRate ||
    values.restingHeartRate.trim() !== savedValues.restingHeartRate ||
    values.functionalThresholdPower.trim() !==
      savedValues.functionalThresholdPower

  const setField = (field: keyof FieldValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setSaved(false)
    setError(null)
  }

  const reset = () => {
    setValues(savedValues)
    setError(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (invalidReason || !dirty) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const { ok, data } = await updateFitnessGeneralSettings({
        maxHeartRate: maxHeartRate ?? null,
        restingHeartRate: restingHeartRate ?? null,
        functionalThresholdPower: functionalThresholdPower ?? null
      })
      if (!ok) {
        setError(data?.error || 'Failed to save training zones.')
        return
      }
      const next = toFieldValues({
        maxHeartRate: data.maxHeartRate,
        restingHeartRate: data.restingHeartRate,
        functionalThresholdPower: data.functionalThresholdPower
      })
      setValues(next)
      setSavedValues(next)
      setSaved(true)
    } catch {
      setError('Failed to save training zones.')
    } finally {
      setSaving(false)
    }
  }

  const numberField = (
    id: string,
    field: keyof FieldValues,
    range: { min: number; max: number },
    describedBy: string | undefined
  ) => (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={range.min}
      max={range.max}
      step={1}
      aria-describedby={describedBy}
      value={values[field]}
      onChange={(event) => setField(field)(event.target.value)}
      disabled={saving}
    />
  )

  return (
    <Section
      title="Training zones"
      description="Used for the zone charts on your activities. Until you set them, activities use default zones."
    >
      <form onSubmit={handleSubmit} method="post">
        <Frame
          form
          footer={
            <SaveBar
              submit
              actionLabel="Save zones"
              dirty={dirty}
              saving={saving}
              saved={saved}
              error={error}
              disabledReason={dirty ? invalidReason : undefined}
              actions={
                <Button
                  type="button"
                  variant="outline"
                  onClick={reset}
                  disabled={!dirty || saving}
                >
                  Reset
                </Button>
              }
            />
          }
        >
          <FormRow
            label="Max heart rate (bpm)"
            htmlFor="zones-max-heart-rate"
            hint="Your highest heart rate. Zones are worked out from it."
          >
            {({ describedBy }) =>
              numberField(
                'zones-max-heart-rate',
                'maxHeartRate',
                MAX_HEART_RATE_RANGE,
                describedBy
              )
            }
          </FormRow>
          <FormRow
            label="Resting heart rate (optional)"
            htmlFor="zones-resting-heart-rate"
            hint="Optional. With it, zones use your heart-rate reserve."
          >
            {({ describedBy }) =>
              numberField(
                'zones-resting-heart-rate',
                'restingHeartRate',
                RESTING_HEART_RATE_RANGE,
                describedBy
              )
            }
          </FormRow>
          <FormRow
            label="Heart rate zones"
            hint={isDefaultHeartRateZones ? 'Default zones' : undefined}
          >
            <ZonePreview
              label="Heart rate zones preview"
              zones={heartRateZones}
              unit="bpm"
            />
          </FormRow>
          <FormRow
            label="Functional threshold power (W)"
            htmlFor="zones-functional-threshold-power"
            hint="The power you can hold for about an hour."
          >
            {({ describedBy }) =>
              numberField(
                'zones-functional-threshold-power',
                'functionalThresholdPower',
                FUNCTIONAL_THRESHOLD_POWER_RANGE,
                describedBy
              )
            }
          </FormRow>
          <FormRow label="Power zones">
            {powerZones ? (
              <ZonePreview
                label="Power zones preview"
                zones={powerZones}
                unit="W"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Set your functional threshold power to see your power zones.
              </p>
            )}
          </FormRow>
        </Frame>
      </form>
    </Section>
  )
}
