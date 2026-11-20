// Lists the package names a Yarn Berry lockfile gained, so the Dependabot
// auto-merge workflow can leave a PR that pulls in a package the base branch
// never had for a human. Pure so it can be unit tested; the workflow reads
// both lockfiles with `git show` and runs this file from the base commit.
import console from 'node:console'
import process from 'node:process'

// A locator is `<name>@<protocol>:<reference>`, e.g. `@scope/a@npm:1.0.0`.
// The name ends at the `@` that starts the reference; a scoped name starts
// with `@`, so its own `@` is skipped.
const splitLocator = (locator) => {
  const separator = locator.startsWith('@')
    ? locator.indexOf('@', 1)
    : locator.indexOf('@')
  if (separator <= 0) return null
  return {
    name: locator.slice(0, separator),
    reference: locator.slice(separator + 1)
  }
}

// What an entry contributes to the comparison. A plain registry package is its
// name, so a version bump is not "new". Anything else — a tarball URL, a
// `file:`/`exec:`/`git:` source, a non-builtin patch, an `__archiveUrl` — is
// the whole locator, so a new source always shows up as new.
const contributionOf = (locator) => {
  // Workspace entries (`@workspace:packages/foo`) are not registry packages.
  if (locator.includes('@workspace:')) return null

  const parts = splitLocator(locator)
  if (!parts) return locator

  if (parts.reference.startsWith('npm:')) {
    const version = parts.reference.slice('npm:'.length)
    // `name@npm:<version>` is the registry; a `::` suffix (e.g.
    // `::__archiveUrl=`) means the tarball came from somewhere else.
    if (version && !version.includes('::')) return parts.name
    return locator
  }

  // A builtin compat patch (`name@patch:name@npm%3A…#optional!builtin<compat/…>`)
  // is the package itself; any other patch is a source of its own.
  if (
    parts.reference.startsWith('patch:') &&
    /@npm%3A[^#]*#.*builtin<compat\//.test(parts.reference)
  )
    return parts.name

  return locator
}

// Each entry has exactly one `resolution:` line, indented two spaces. The
// descriptor keys are not used: they can exceed 1024 characters and be written
// as `? "…"` + `:` lines, and an alias chain (`npm:a@npm:b@…`) hides the real
// name. `__metadata` has no resolution.
const resolutions = (lockfile) =>
  lockfile
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => /^ {2}resolution: (.*)$/.exec(line)?.[1])
    .filter((value) => value !== undefined)
    .map((value) => value.replace(/^"(.*)"$/, '$1'))

/**
 * @param {string} lockfile  A Yarn Berry `yarn.lock` text.
 * @returns {Set<string>} Every package name (or non-registry locator) the
 *   lockfile resolves.
 */
export const packageNames = (lockfile) => {
  const names = new Set()
  for (const locator of resolutions(lockfile)) {
    const contribution = contributionOf(locator)
    if (contribution) names.add(contribution)
  }
  return names
}

/**
 * @param {string} base  The base branch's `yarn.lock`.
 * @param {string} head  The PR's `yarn.lock`.
 * @returns {string[]} Names in `head` that `base` does not have, sorted.
 */
export const newPackages = (base, head) => {
  const before = packageNames(base)
  return [...packageNames(head)].filter((name) => !before.has(name)).sort()
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop())
) {
  const { readFileSync } = await import('node:fs')
  const [basePath, headPath] = process.argv.slice(2)
  if (!basePath || !headPath) {
    console.error(
      'usage: node lockfile-new-packages.mjs <base-lockfile> <head-lockfile>'
    )
    process.exit(1)
  }
  for (const name of newPackages(
    readFileSync(basePath, 'utf8'),
    readFileSync(headPath, 'utf8')
  ))
    console.log(name)
}
