// GBIF ranks at or below species.
export const SPECIES_OR_LOWER_RANKS: ReadonlySet<string> = new Set([
  'SPECIES',
  'SUBSPECIES',
  'VARIETY',
  'FORM',
  'INFRASPECIFIC_NAME',
  'INFRASUBSPECIFIC_NAME',
  'ABERRATION',
  'CULTIVAR',
  'STRAIN',
  'FORMA_SPECIALIS'
])
// The ranks a group pick ("Just genus") may name.
export const GROUP_RANKS: ReadonlySet<string> = new Set(['GENUS', 'FAMILY'])

export type IdentificationLevel = 'species' | 'group' | 'unknown'

/** Only a resolved lookup can establish identification rank. */
export const identifyTaxonRank = (
  rank: string | null,
  status: string | null
): IdentificationLevel => {
  if (status !== 'resolved' || rank === null) return 'unknown'
  if (SPECIES_OR_LOWER_RANKS.has(rank)) return 'species'
  if (GROUP_RANKS.has(rank)) return 'group'
  return 'unknown'
}
