// The single rule for keeping an existing status separate from a new fitness
// import's posts, so the import creates its own status instead of merging
// into it. Both moved-account cases live here; importFitnessFilesJob applies
// it, and no caller pre-filters overlap candidates on its own.

type IsolationStatus = {
  to: string[]
  cc: string[]
  createdWhileMoved?: boolean
}

// Which statuses are isolated depends on whether the account is moved now:
//
// - Moved: a status with recipients. It predates the move and federates, and
//   an import running while moved must not expose new activity data through
//   it. Hidden statuses (marked or an ordinary `direct` one) merge, so two
//   files of one ride imported while moved share one hidden record.
// - Not moved: a status carrying the `createdWhileMoved` marker that is still
//   hidden (no recipients). It was created as a hidden local-only record
//   while the account was moved and stays one after the redirect is cleared,
//   so a later import publishes its own post rather than attaching to a
//   status nobody but the owner can see. The owner can still publish it
//   through the post menu's visibility control (`updateNoteVisibility` gives
//   it recipients and keeps the marker); a marked status with recipients is
//   a published post and merges like any other.
//
// A status with no recipients and no marker is an ordinary `direct` import —
// direct visibility with no mentions addresses nobody — and merges as before.
export const isIsolatedFromFitnessImport = ({
  moved,
  status
}: {
  moved: boolean
  status: IsolationStatus
}) =>
  moved
    ? status.to.length > 0 || status.cc.length > 0
    : status.createdWhileMoved === true &&
      status.to.length === 0 &&
      status.cc.length === 0
