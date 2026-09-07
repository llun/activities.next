export interface FitnessGeneralSettingsResponse {
  success?: boolean
  error?: string
  privacyLocations?: Array<{
    latitude: number
    longitude: number
    hideRadiusMeters: number
  }>
  privacyHomeLatitude?: number | null
  privacyHomeLongitude?: number | null
  privacyHideRadiusMeters?: number
}

export interface FitnessPrivacyLocationInput {
  latitude: number
  longitude: number
  hideRadiusMeters: number
}

export interface RegenerateFitnessMapsResponse {
  success?: boolean
  error?: string
  queuedCount?: number
}

// A bare cast would let any 200 with any body count as a loaded settings
// object. `privacyLocations` would then read as an empty list, and because a
// save REPLACES the whole stored list, the next save would wipe every zone the
// actor configured. Reject the body instead so the caller's load-failure path
// handles it.
const assertFitnessGeneralSettings = (
  value: unknown
): FitnessGeneralSettingsResponse => {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as FitnessGeneralSettingsResponse).privacyLocations)
  ) {
    throw new Error('Unexpected fitness privacy settings response')
  }

  return value as FitnessGeneralSettingsResponse
}

export const getFitnessGeneralSettings =
  async (): Promise<FitnessGeneralSettingsResponse> => {
    const response = await fetch('/api/v1/fitness/general', {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error('Failed to load fitness privacy settings')
    }

    return assertFitnessGeneralSettings(await response.json())
  }

export const updateFitnessGeneralSettings = async (
  privacyLocations: FitnessPrivacyLocationInput[]
): Promise<{ ok: boolean; data: FitnessGeneralSettingsResponse }> => {
  const response = await fetch('/api/v1/fitness/general', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      privacyLocations
    })
  })

  const data = (await response.json()) as FitnessGeneralSettingsResponse

  // On success the caller rebuilds its list from this body, so an unrecognised
  // 200 must not be reported as a save — it would blank the list under a
  // "saved" message and invite the user to save the emptiness for real.
  if (response.ok) {
    return { ok: true, data: assertFitnessGeneralSettings(data) }
  }

  return { ok: false, data }
}

export const regenerateFitnessMaps = async (): Promise<{
  ok: boolean
  data: RegenerateFitnessMapsResponse
}> => {
  const response = await fetch('/api/v1/fitness/general/regenerate-maps', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })

  const data = (await response.json()) as RegenerateFitnessMapsResponse
  return { ok: response.ok, data }
}
