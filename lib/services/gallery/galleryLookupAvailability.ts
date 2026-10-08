import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

// What the gallery settings entity reports about this instance's lookups, so
// the owner's pages can say what will and will not happen.

export interface GalleryLookupAvailability {
  subjectSuggestionsAvailable: boolean
  // Shown to the owner as "Suggested by …".
  subjectModel: string | null
  speciesLookupsAvailable: boolean
  placeLookupsAvailable: boolean
}

// The instance switches `network.speciesLookups` and `network.placeLookups`
// (Admin › Network). Read loosely so this module does not depend on the
// registry's exact shape; an absent switch is its default, on.
type LookupSwitches = Partial<
  Record<'speciesLookups' | 'placeLookups', boolean>
>

export const getGalleryLookupAvailability = async (
  database: Database
): Promise<GalleryLookupAvailability> => {
  const config = getConfig() as ReturnType<typeof getConfig> & {
    gallery?: { subjects?: { model: string } | null }
  }
  // `config.gallery.subjects` is the subject provider (the alt text endpoint
  // and key with an optional model override); null when it is switched off or
  // there is no alt text configuration to reuse.
  const subjects =
    config.gallery !== undefined
      ? (config.gallery.subjects ?? null)
      : config.altText
        ? { model: config.altText.model }
        : null

  const network = (await getResolvedServerSettings(database))
    .network as LookupSwitches

  return {
    subjectSuggestionsAvailable: subjects !== null,
    subjectModel: subjects?.model ?? null,
    speciesLookupsAvailable: network.speciesLookups !== false,
    placeLookupsAvailable: network.placeLookups !== false
  }
}
