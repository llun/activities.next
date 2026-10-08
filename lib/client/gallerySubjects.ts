import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import type { MediaSubjectCategory } from '@/lib/types/database/gallery'

import { parseApiError } from './http'

/** The vision model's candidates for one media; owner-only. */
export type SubjectSuggestionsEntity = NonNullable<
  MediaDetailsEntity['subjectSuggestions']
>

/** One species the GBIF backbone matched in the picker's search. */
export interface GalleryTaxonEntity {
  taxonKey: string
  scientificName: string
  vernacularName: string | null
  rank: string
  category: MediaSubjectCategory
  taxonPath: string[]
}

/**
 * Asks the instance's image model for the subject of a stored media, checked
 * against GBIF when the server can. Answers from the stored suggestions unless
 * `refresh` is set, so reopening the dialog never asks the model again. Nothing
 * is applied: show the candidates and let the author choose. Rejects with the
 * server's message when suggestions are not configured or failed.
 */
export const suggestMediaSubjects = async (
  mediaId: string,
  { refresh = false }: { refresh?: boolean } = {}
): Promise<SubjectSuggestionsEntity> => {
  const response = await fetch(
    `/api/v1/media/${encodeURIComponent(mediaId)}/subject-suggestions`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(refresh ? { refresh: true } : {})
    }
  )
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, 'Subjects could not be suggested.')
    )
  }
  const data = (await response.json()) as {
    suggestions: SubjectSuggestionsEntity
  }
  return data.suggestions
}

/** The server answered 503: species search is switched off or GBIF is down. */
export class TaxaSearchUnavailableError extends Error {
  constructor(message = "Species search isn't available") {
    super(message)
    this.name = 'TaxaSearchUnavailableError'
  }
}

/**
 * Searches the GBIF backbone for up to 10 species by scientific or common
 * name. Rejects with `TaxaSearchUnavailableError` when the server cannot search
 * (lookups switched off or GBIF unreachable), so the picker can say so.
 */
export const searchGalleryTaxa = async (
  query: string,
  { signal }: { signal?: AbortSignal } = {}
): Promise<GalleryTaxonEntity[]> => {
  const response = await fetch(
    `/api/v1/gallery/taxa?q=${encodeURIComponent(query)}`,
    { method: 'GET', headers: { Accept: 'application/json' }, signal }
  )
  if (response.status === 503) throw new TaxaSearchUnavailableError()
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to search species.'))
  }
  const data = (await response.json()) as { taxa: GalleryTaxonEntity[] }
  return data.taxa
}

/**
 * Asks the server to run the subject (IUCN) and place lookups again, for the
 * "Couldn't check · Retry" affordance. Resolves to the owner's fresh details.
 */
export const retryMediaLookups = async (
  mediaId: string
): Promise<MediaDetailsEntity> => {
  const response = await fetch(
    `/api/v1/media/${encodeURIComponent(mediaId)}/lookups`,
    { method: 'POST', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to retry the check.'))
  }
  const data = (await response.json()) as { details: MediaDetailsEntity }
  return data.details
}
