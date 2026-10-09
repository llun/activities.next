'use client'

import { FC, useState } from 'react'

import {
  FitnessGeneralSettingsResponse,
  getFitnessGeneralSettings,
  regenerateFitnessMaps,
  updateFitnessGeneralSettings
} from '@/lib/client'
import {
  PrivacyLocationInput,
  PrivacyLocationsCopy,
  PrivacyLocationsEditor,
  PrivacyLocationsFooterContext,
  PrivacyLocationsSaveError
} from '@/lib/components/privacy-locations/PrivacyLocationsEditor'
import { Alert } from '@/lib/components/surface/Alert'
import { Section } from '@/lib/components/surface/Section'
import { Button } from '@/lib/components/ui/button'
import { Label } from '@/lib/components/ui/label'
import { Switch } from '@/lib/components/ui/switch'
import {
  sanitizePrivacyLocationSettings,
  sanitizePrivacyRadiusMeters
} from '@/lib/services/fitness-files/privacy'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

interface Props {
  /** Which map backend renders the location picker. */
  mapProvider: PublicMapProvider
}

const FITNESS_COPY: PrivacyLocationsCopy = {
  saved: 'Fitness privacy location settings saved.',
  cleared: 'Fitness privacy location settings cleared.',
  saveFailed: 'Failed to save fitness privacy location settings',
  saveButton: 'Save privacy locations',
  hideRadiusHelp:
    'When a route starts or finishes here, that end is hidden from other viewers until it leaves the area and has covered this distance. The middle of a route is never cut, so a route that later passes back through the area stays visible.'
}

const toResponsePrivacyLocations = (
  data: FitnessGeneralSettingsResponse
): PrivacyLocationInput[] => {
  const locations = sanitizePrivacyLocationSettings(data.privacyLocations)

  if (locations.length > 0) {
    return locations
  }

  const latitude = data.privacyHomeLatitude
  const longitude = data.privacyHomeLongitude
  const hideRadiusMeters = sanitizePrivacyRadiusMeters(
    data.privacyHideRadiusMeters
  )

  if (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    hideRadiusMeters > 0
  ) {
    return [
      {
        latitude,
        longitude,
        hideRadiusMeters
      }
    ]
  }

  return []
}

/**
 * The Fitness privacy page: the shared locations editor wired to the fitness
 * general settings, plus the regenerate-maps footer and the route description
 * switch, which only Fitness has.
 */
export const FitnessPrivacyLocationSettings: FC<Props> = ({ mapProvider }) => {
  const [isEditingDisabled, setIsEditingDisabled] = useState(true)
  const [generateRouteDescription, setGenerateRouteDescription] =
    useState(false)
  const [isSavingRouteDescription, setIsSavingRouteDescription] =
    useState(false)
  // The regenerate button's busy state lives in the editor's footer context;
  // the route description switch is outside it, so the handler mirrors it here
  // to keep that switch locked while the maps are being queued.
  const [isRegeneratingMaps, setIsRegeneratingMaps] = useState(false)
  const [routeDescriptionMessage, setRouteDescriptionMessage] = useState<
    string | null
  >(null)
  const [routeDescriptionError, setRouteDescriptionError] = useState<
    string | null
  >(null)

  const load = async (): Promise<PrivacyLocationInput[]> => {
    const data = await getFitnessGeneralSettings()
    setGenerateRouteDescription(Boolean(data.generateRouteDescription))
    return toResponsePrivacyLocations(data)
  }

  const save = async (
    locations: PrivacyLocationInput[]
  ): Promise<PrivacyLocationInput[]> => {
    const { ok, data } = await updateFitnessGeneralSettings({
      privacyLocations: locations
    })

    if (!ok) {
      throw new PrivacyLocationsSaveError(
        data?.error || FITNESS_COPY.saveFailed
      )
    }

    if (data.generateRouteDescription !== undefined) {
      setGenerateRouteDescription(Boolean(data.generateRouteDescription))
    }
    return toResponsePrivacyLocations(data)
  }

  const handleRegenerateOldStatusMaps = async ({
    setBusy,
    setError,
    setMessage
  }: PrivacyLocationsFooterContext) => {
    setError(null)
    setMessage(null)
    setBusy(true)
    setIsRegeneratingMaps(true)

    try {
      const { ok, data } = await regenerateFitnessMaps()

      if (!ok) {
        setError(data.error || 'Failed to queue map regeneration job.')
        return
      }

      const queuedCount =
        typeof data.queuedCount === 'number' ? data.queuedCount : 0
      if (queuedCount === 0) {
        setMessage('No old statuses are pending map regeneration.')
      } else {
        setMessage(
          `Queued map regeneration for ${queuedCount} old status${queuedCount > 1 ? 'es' : ''}.`
        )
      }
    } catch {
      setError('Failed to queue map regeneration job.')
    } finally {
      setBusy(false)
      setIsRegeneratingMaps(false)
    }
  }

  const handleToggleRouteDescription = async (checked: boolean) => {
    setRouteDescriptionError(null)
    setRouteDescriptionMessage(null)
    setGenerateRouteDescription(checked)
    setIsSavingRouteDescription(true)

    try {
      const { ok, data } = await updateFitnessGeneralSettings({
        generateRouteDescription: checked
      })

      if (!ok) {
        setGenerateRouteDescription(!checked)
        setRouteDescriptionError(
          data?.error || 'Failed to update route description setting.'
        )
        return
      }

      setGenerateRouteDescription(Boolean(data.generateRouteDescription))
      setRouteDescriptionMessage(
        checked
          ? 'AI route description enabled for new and regenerated maps.'
          : 'AI route description disabled.'
      )
    } catch {
      setGenerateRouteDescription(!checked)
      setRouteDescriptionError('Failed to update route description setting.')
    } finally {
      setIsSavingRouteDescription(false)
    }
  }

  return (
    <div className="space-y-6">
      <Section
        title="Privacy location"
        description="Trim the start and finish of your routes around your saved privacy locations, on your activity maps and generated route images. Route heatmaps are not trimmed: hiding the ends there would leave a gap that points at the location just as clearly."
      >
        <PrivacyLocationsEditor
          mapProvider={mapProvider}
          load={load}
          save={save}
          copy={FITNESS_COPY}
          mapIdPrefix="fitness-privacy"
          onEditingDisabledChange={setIsEditingDisabled}
          footer={(context) => (
            <Button
              variant="outline"
              onClick={() => handleRegenerateOldStatusMaps(context)}
              disabled={context.disabled || context.busy}
            >
              {context.busy
                ? 'Queueing regeneration…'
                : 'Regenerate maps for old statuses'}
            </Button>
          )}
        />
      </Section>

      <Section
        title="Route map description"
        description="Configure accessibility descriptions for your activity route maps."
      >
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 space-y-0.5">
              <Label
                htmlFor="generate-route-description"
                className="cursor-pointer"
              >
                Generate AI route description
              </Label>
              <p className="text-[0.8rem] text-muted-foreground">
                Automatically generate an alt-text description of the route
                using AI when activity maps are created or regenerated. Off by
                default.
              </p>
            </div>
            <Switch
              id="generate-route-description"
              checked={generateRouteDescription}
              onCheckedChange={handleToggleRouteDescription}
              disabled={
                isEditingDisabled ||
                isSavingRouteDescription ||
                isRegeneratingMaps
              }
            />
          </div>

          {routeDescriptionError ? (
            <Alert title={routeDescriptionError} />
          ) : null}
          {routeDescriptionMessage ? (
            <p className="text-sm text-success-text">
              {routeDescriptionMessage}
            </p>
          ) : null}
        </div>
      </Section>
    </div>
  )
}
