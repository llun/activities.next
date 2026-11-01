import { isIsolatedFromFitnessImport } from '@/lib/jobs/fitnessImportIsolation'

describe('isIsolatedFromFitnessImport', () => {
  it('isolates a status created while moved only after the redirect is cleared', () => {
    // Another import while still moved joins the same hidden record.
    expect(
      isIsolatedFromFitnessImport({
        moved: true,
        status: { to: [], cc: [], createdWhileMoved: true }
      })
    ).toBe(false)
    expect(
      isIsolatedFromFitnessImport({
        moved: false,
        status: { to: [], cc: [], createdWhileMoved: true }
      })
    ).toBe(true)
  })

  it('merges a marked but now public status after the clear', () => {
    // The owner published the moved-time status through the post menu's
    // visibility control: updateNoteVisibility clears the marker when the
    // audience changes, so a published status no longer carries it. This
    // checks the predicate for a marked status that has recipients anyway:
    // a published post merges like any other, so a later overlapping import
    // attaches to it instead of creating a second post.
    expect(
      isIsolatedFromFitnessImport({
        moved: false,
        status: {
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          createdWhileMoved: true
        }
      })
    ).toBe(false)
  })
})
