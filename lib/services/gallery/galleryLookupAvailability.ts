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

export const getGalleryLookupAvailability = async (
  database: Database
): Promise<GalleryLookupAvailability> => {
  // `gallery.subjects` is the subject provider (the alt text endpoint and key
  // with an optional model override); null when it is switched off or there
  // is no alt text configuration to reuse.
  const { subjects } = getConfig().gallery
  const { network } = await getResolvedServerSettings(database)

  return {
    subjectSuggestionsAvailable: subjects !== null,
    subjectModel: subjects?.model ?? null,
    speciesLookupsAvailable: network.speciesLookups,
    placeLookupsAvailable: network.placeLookups
  }
}
