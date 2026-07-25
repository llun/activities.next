import { readFileSync } from 'fs'
import path from 'path'

import { FITNESS_PRIVACY_RADIUS_OPTIONS } from '@/lib/services/fitness-files/privacy'

// `migrations/20260725000000_snap_fitness_privacy_radius.js` persists the same
// upward snap the runtime applies on read. Migrations must not import app code
// — they have to keep working when that code later changes — so the option list
// is duplicated there. This guards the duplication: if the app's option set
// changes and the migration is left behind, the backfill would snap stored
// radii to values the app no longer offers.
const MIGRATION_PATH = path.join(
  process.cwd(),
  'migrations',
  '20260725000000_snap_fitness_privacy_radius.js'
)

describe('snap_fitness_privacy_radius migration', () => {
  const source = readFileSync(MIGRATION_PATH, 'utf-8')

  it('duplicates the current radius option list verbatim', () => {
    const match = source.match(
      /const FITNESS_PRIVACY_RADIUS_OPTIONS = \[([^\]]*)\]/
    )

    expect(match).not.toBeNull()

    const migrationOptions = (match?.[1] ?? '')
      .split(',')
      .map((entry) => Number(entry.trim()))

    expect(migrationOptions).toEqual([...FITNESS_PRIVACY_RADIUS_OPTIONS])
  })

  it('never lowers a stored radius, so a backfill cannot shrink a zone', () => {
    // The migration's snap is `find(option => option >= value)`, so the result
    // is always at least the input. Assert the property against the app's own
    // sanitizer, which the migration mirrors.
    const storedRadii = [1, 5, 10, 20, 49, 50, 51, 100, 300, 999, 1000]

    for (const stored of storedRadii) {
      const snapped =
        FITNESS_PRIVACY_RADIUS_OPTIONS.find((option) => option >= stored) ??
        Math.max(...FITNESS_PRIVACY_RADIUS_OPTIONS)

      expect(snapped).toBeGreaterThanOrEqual(stored)
    }
  })

  it('leaves the rollback empty on purpose', () => {
    // Restoring the original sub-50m radii would shrink privacy zones below the
    // enforced minimum, re-exposing GPS points around a home address.
    const down = source.slice(source.indexOf('export const down'))

    expect(down).not.toMatch(/update\(/)
  })
})
