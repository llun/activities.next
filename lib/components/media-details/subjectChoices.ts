import type { SubjectSuggestionsEntity } from '@/lib/client'
import type { MediaSubjectCategory } from '@/lib/types/database/gallery'

import type { PickedSubject } from './mediaDetailsDraft'

type Candidate = SubjectSuggestionsEntity['candidates'][number]

export const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1)

export const toPercent = (confidence: number) =>
  Math.round(Math.min(1, Math.max(0, confidence)) * 100)

export const candidateToPicked = (candidate: Candidate): PickedSubject => ({
  name: candidate.name,
  scientificName: candidate.scientificName ?? '',
  category: candidate.category,
  taxonKey: candidate.taxonKey ?? '',
  taxonPath: candidate.taxonPath
})

/** A whole kind of subject ("Bird"), with no species named. */
export const groupToPicked = (
  label: string,
  category: MediaSubjectCategory | ''
): PickedSubject => ({
  name: label,
  scientificName: '',
  category,
  taxonKey: '',
  taxonPath: []
})

export interface SubjectChoices {
  /** The candidates at or above the author's confidence threshold. */
  species: Candidate[]
  /**
   * The broad pick. `named` is whether a species was confident enough to offer
   * (the chip then reads `Just “Bird”`); otherwise it is only a guess at the
   * kind (`Bird?`), which is all the author is offered.
   */
  group: {
    label: string
    category: MediaSubjectCategory
    named: boolean
  } | null
}

/**
 * What the dialog offers for one media: species at or above the threshold,
 * then the group. Below the threshold only the group guess is offered, so a
 * shaky species name never reaches a post unless the author searches for it.
 */
export const getSubjectChoices = (
  suggestions: SubjectSuggestionsEntity | null,
  thresholdPercent: number
): SubjectChoices => {
  if (!suggestions) return { species: [], group: null }
  const species = suggestions.candidates.filter(
    (candidate) => toPercent(candidate.confidence) >= thresholdPercent
  )
  const category = suggestions.group ?? suggestions.candidates[0]?.category
  return {
    species,
    group: category
      ? { label: capitalize(category), category, named: species.length > 0 }
      : null
  }
}

/**
 * The broad pick for a species: its genus when the name has one, else the last
 * (lowest) rank of its path, so "Zosterops japonicus" offers `Just “Zosterops”`.
 * Null when the taxon is unnamed.
 */
export const getHigherTaxon = (
  scientificName: string | null,
  taxonPath: string[]
): { name: string; rank: 'genus' | 'family' } | null => {
  const words = scientificName?.trim().split(/\s+/)
  if (words && words.length > 1) return { name: words[0], rank: 'genus' }
  return taxonPath.length > 0
    ? { name: taxonPath[taxonPath.length - 1], rank: 'family' }
    : null
}
