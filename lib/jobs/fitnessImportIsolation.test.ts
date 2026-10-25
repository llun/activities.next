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

  it('isolates a recipient-carrying status only while the account is moved', () => {
    expect(
      isIsolatedFromFitnessImport({
        moved: true,
        status: { to: ['https://www.w3.org/ns/activitystreams#Public'], cc: [] }
      })
    ).toBe(true)
    expect(
      isIsolatedFromFitnessImport({
        moved: false,
        status: { to: ['https://www.w3.org/ns/activitystreams#Public'], cc: [] }
      })
    ).toBe(false)
  })

  it('merges an ordinary direct status: no recipients and no marker', () => {
    expect(
      isIsolatedFromFitnessImport({
        moved: false,
        status: { to: [], cc: [] }
      })
    ).toBe(false)
  })
})
