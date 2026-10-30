import fs from 'fs'
import path from 'path'

// A post link in a feed does not prefetch, so a signed-in click on it streams
// the status page: any `loading.*` on the path to it (here, or in a parent
// segment, which wraps every child segment) is painted for a split second
// before the page arrives, on every click. The status route therefore has no
// loading boundary on purpose: the timeline stays on screen until the status
// page is ready and then shows it complete, as a logged-out full load does.
// A slow open still gets feedback: `PendingProfileOverlay` paints
// `StatusLoadingSkeleton` only after `PENDING_STATUS_DELAY_MS`, so a fast
// navigation never flashes it.
// The profile skeleton lives in `[actor]/(profile)/loading.tsx`, a route
// group that wraps only the profile page (see "Link prefetching in feeds" in
// docs/architecture.md).

const LOADING_FILE = /^loading\.(tsx?|jsx?)$/

const loadingFilesIn = (directory: string) =>
  fs
    .readdirSync(path.join(process.cwd(), directory))
    .filter((name) => LOADING_FILE.test(name))

describe('status page loading boundary', () => {
  it.each([
    'app',
    'app/(timeline)',
    'app/(timeline)/[actor]',
    'app/(timeline)/[actor]/[status]'
  ])('%s has no loading file on the path to the status page', (directory) => {
    expect(
      loadingFilesIn(directory),
      `${directory} must not have a loading file: it would paint a skeleton before the status page on every signed-in click. Put the profile skeleton in app/(timeline)/[actor]/(profile)/loading.tsx.`
    ).toEqual([])
  })

  it('keeps the profile skeleton in the (profile) route group', () => {
    expect(
      fs.existsSync(
        path.join(process.cwd(), 'app/(timeline)/[actor]/(profile)/loading.tsx')
      )
    ).toBe(true)
  })
})
