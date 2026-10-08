import { z } from 'zod'

import { requestVisionCompletion } from '@/lib/services/altText/openai'
import type { GbifClient } from '@/lib/services/gallery/lookups/gbif'
import {
  NormalizedTaxon,
  SPECIES_OR_LOWER_RANKS,
  kingdomOfCategory
} from '@/lib/services/gallery/lookups/normalizeTaxon'
import type { SubjectProviderConfig } from '@/lib/services/gallery/subjects/subjectProvider'
import {
  MEDIA_SUBJECT_CATEGORIES,
  MediaSubjectCategory,
  MediaSubjectSuggestions
} from '@/lib/types/database/gallery'

// The vision model answers with a few candidates for the main subject of one
// photo. Its output is untrusted text: it is parsed strictly, bounded, stored as
// owner-only suggestions, and never written to the `subject*` columns. Only the
// owner's save does that.

export const MAX_SUGGESTED_CANDIDATES = 3
const MAX_TEXT_LENGTH = 255
const MAX_PATH_NAME_LENGTH = 64
const MAX_COMPLETION_TOKENS = 400

export const SUBJECT_SYSTEM_PROMPT = `You identify the main subject of a photograph for a nature and photography gallery. Answer with a single JSON object and nothing else, in this shape: {"subjects":[{"name":"common name","scientificName":"Genus species or null","category":"bird","confidence":0.8}],"group":"bird"}. List at most ${MAX_SUGGESTED_CANDIDATES} subjects, most likely first. "category" and "group" must each be one of: ${MEDIA_SUBJECT_CATEGORIES.join(', ')}. "confidence" is your probability between 0 and 1 that the subject is that species. "group" is the broad kind of subject, or null when there is no clear subject. Use "landscape" for scenery. Give a scientificName only for a living organism and only when you are sure of the genus. Never describe the photo, never add commentary.`

export const SUBJECT_USER_PROMPT = 'What is the main subject of this photo?'

export class SubjectSuggestionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubjectSuggestionError'
  }
}

const categoryOf = (value: unknown): MediaSubjectCategory | null => {
  if (typeof value !== 'string') return null
  const lowered = value.trim().toLowerCase()
  return (MEDIA_SUBJECT_CATEGORIES as readonly string[]).includes(lowered)
    ? (lowered as MediaSubjectCategory)
    : null
}

const RawCandidate = z.object({
  name: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  scientificName: z
    .string()
    .trim()
    .max(MAX_TEXT_LENGTH)
    .nullish()
    .transform((value) => value || null),
  category: z.unknown().optional(),
  confidence: z.number().finite()
})

// A model asked for 0..1 sometimes answers in percent. From 2 up to 100 it
// can only mean percent; between 1 and 2 it is just over-confident and clamps.
const toConfidence = (value: number) => {
  const fraction = value >= 2 && value <= 100 ? value / 100 : value
  return Math.min(1, Math.max(0, fraction))
}

export interface ParsedSubjects {
  candidates: MediaSubjectSuggestions['candidates']
  group: MediaSubjectCategory | null
}

/**
 * Reads the model's answer: tolerates a code fence or chatter around the JSON
 * (takes the first `{` to the last `}`), keeps the candidates that validate,
 * coerces an unknown category to `other` and clamps confidence to 0..1.
 * Returns null when there is no JSON object at all.
 */
export const parseSubjectSuggestions = (
  text: string
): ParsedSubjects | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let json: unknown
  try {
    json = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return null
  }

  // An object that has neither key is some other JSON, not an answer.
  if (!('subjects' in json) && !('group' in json)) return null

  const { subjects, group } = json as { subjects?: unknown; group?: unknown }
  const seen = new Set<string>()
  const candidates: ParsedSubjects['candidates'] = []
  for (const raw of Array.isArray(subjects) ? subjects : []) {
    const parsed = RawCandidate.safeParse(raw)
    if (!parsed.success) continue
    const key = parsed.data.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      name: parsed.data.name,
      scientificName: parsed.data.scientificName,
      category: categoryOf(parsed.data.category) ?? 'other',
      confidence: toConfidence(parsed.data.confidence),
      taxonKey: null,
      rank: null,
      taxonPath: []
    })
  }
  candidates.sort((a, b) => b.confidence - a.confidence)

  return {
    candidates: candidates.slice(0, MAX_SUGGESTED_CANDIDATES),
    group: categoryOf(group)
  }
}

type GbifLookup = Pick<GbifClient, 'matchTaxon' | 'lookupSearch'>

/**
 * Checks one candidate against the GBIF backbone: by its scientific name when
 * the model gave one, otherwise by a vernacular-name search. The model's
 * common name is kept as it is; a taxon only adds the canonical scientific
 * name, key, rank and path.
 *
 * A key attached here reaches the subject job as a stored key when the owner
 * picks the chip, so a common name is given one only under the job's own
 * rules for a search (Addendum 2, path 3): every result readable, GBIF's
 * last page, exactly one result naming the candidate exactly, at species
 * rank and in the kingdom the model's category names. Anything else leaves
 * the candidate unchecked, with no key and the model's category ("Panda" is
 * not the tree Panda oleosa). A taxon from another kingdom never replaces a
 * living category, by either path.
 */
const checkCandidate = async (
  candidate: ParsedSubjects['candidates'][number],
  gbif: GbifLookup
): Promise<ParsedSubjects['candidates'][number]> => {
  if (candidate.category === 'landscape') return candidate
  const kingdom = kingdomOfCategory(candidate.category)

  let taxon: NormalizedTaxon | null
  if (candidate.scientificName) {
    taxon = await gbif.matchTaxon(candidate.scientificName, {
      kingdom: kingdom ?? undefined
    })
  } else {
    // A common name is only confirmed for a category that names a kingdom.
    if (!kingdom) return candidate
    const search = await gbif.lookupSearch(candidate.name)
    if (
      !search ||
      !search.complete ||
      !search.exhaustive ||
      search.exactTaxonKeys.length !== 1
    ) {
      return candidate
    }
    const [exactKey] = search.exactTaxonKeys
    const hit = search.results.find((result) => result.taxonKey === exactKey)
    if (!hit || !SPECIES_OR_LOWER_RANKS.has(hit.rank.toUpperCase())) {
      return candidate
    }
    taxon = hit
  }
  if (!taxon) return candidate
  if (kingdom && taxon.taxonPath[0] !== kingdom) return candidate

  return {
    ...candidate,
    scientificName: taxon.scientificName,
    category: taxon.category !== 'other' ? taxon.category : candidate.category,
    taxonKey: taxon.taxonKey,
    rank: taxon.rank,
    taxonPath: taxon.taxonPath.map((name) =>
      name.slice(0, MAX_PATH_NAME_LENGTH)
    )
  }
}

export interface SuggestSubjectsParams {
  config: SubjectProviderConfig
  image: { buffer: Buffer; mimeType: string }
  /** Null skips the GBIF check; the suggestions then come back unchecked. */
  gbif: GbifLookup | null
  now?: () => Date
}

/**
 * Asks the vision model for the photo's subject candidates and, when GBIF is
 * available, checks each against the backbone taxonomy. THROWS
 * `SubjectSuggestionError` when the model cannot be reached or answers with
 * nothing usable (the caller persists nothing); a GBIF failure only means the
 * suggestions come back unchecked.
 */
export const suggestSubjects = async ({
  config,
  image,
  gbif,
  now = () => new Date()
}: SuggestSubjectsParams): Promise<MediaSubjectSuggestions> => {
  let answer: string | null
  try {
    answer = await requestVisionCompletion(
      config,
      image.buffer,
      image.mimeType,
      {
        systemPrompt: SUBJECT_SYSTEM_PROMPT,
        prompt: SUBJECT_USER_PROMPT,
        maxTokens: MAX_COMPLETION_TOKENS
      }
    )
  } catch (error) {
    throw new SubjectSuggestionError(
      error instanceof Error ? error.message : 'The vision request failed'
    )
  }

  const parsed = answer ? parseSubjectSuggestions(answer) : null
  if (!parsed) {
    throw new SubjectSuggestionError('The model did not answer with subjects')
  }

  let candidates = parsed.candidates
  let checkedAgainst: MediaSubjectSuggestions['checkedAgainst'] = null
  if (gbif && candidates.length > 0) {
    try {
      candidates = await Promise.all(
        candidates.map((candidate) => checkCandidate(candidate, gbif))
      )
      checkedAgainst = 'gbif'
    } catch {
      // GBIF is down or limited: keep the model's own names, unchecked.
      candidates = parsed.candidates
    }
  }

  return {
    model: config.model,
    generatedAt: now().toISOString(),
    checkedAgainst,
    candidates,
    group: parsed.group
  }
}
