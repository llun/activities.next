// Lists the package names a Yarn Berry lockfile gained, and the registry
// versions it pins that the base branch did not, so the Dependabot auto-merge
// workflow can leave a PR that pulls in a package the base branch never had —
// or a version published too recently — for a human. Pure so it can be unit
// tested; the workflow reads both lockfiles with `git show` and runs this file
// from the base commit.
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

const NPM_PACKAGE_NAME =
  /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

const PLAIN_SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

// A plain registry locator is `name@npm:<version>` where `name` is a valid npm
// package name and `version` is plain semver (no `::`, URL, or git spec).
// Anything else — a tarball URL, a `file:`/`exec:`/`git:` source, a patch —
// is not a registry version.
const registryVersionOf = (locator) => {
  const parts = splitLocator(locator)
  if (!parts || !parts.reference.startsWith('npm:')) return null
  const version = parts.reference.slice('npm:'.length)
  if (!NPM_PACKAGE_NAME.test(parts.name) || !PLAIN_SEMVER.test(version))
    return null
  return { name: parts.name, version }
}

// A builtin compat patch (`name@patch:name@npm%3A<version>#optional!builtin<compat/…>`
// with an optional trailing `::version=<semver>&hash=<hex>`) is the package
// itself, but only when it patches that same plain-semver registry package and
// carries exactly one patch: a second patch (`&`- or `,`-joined), an encoded
// `::`/`__archiveUrl`, or a patch of another package is a source of its own.
const isBuiltinCompatPatch = (name, reference) => {
  if (!NPM_PACKAGE_NAME.test(name)) return false
  const match =
    /^patch:(.+)@npm%3A([^#]+)#optional!builtin<compat\/[a-z0-9._-]+>(?:::version=([^&]+)&hash=[0-9a-fA-F]+)?$/.exec(
      reference
    )
  if (!match) return false
  const [, patched, innerVersion, trailingVersion] = match
  if (patched !== name) return false
  if (!PLAIN_SEMVER.test(innerVersion)) return false
  if (trailingVersion !== undefined && !PLAIN_SEMVER.test(trailingVersion))
    return false
  return true
}

// What an entry contributes to the comparison. A plain registry package is its
// name, so a version bump is not "new". Anything else — a tarball URL, a
// `file:`/`exec:`/`git:` source, a non-builtin patch, an `__archiveUrl` — is
// the whole locator, so a new source always shows up as new.
const contributionOf = (locator) => {
  const parts = splitLocator(locator)
  if (!parts) return locator

  // Workspace entries (`@workspace:packages/foo`) are not registry packages.
  // Only the reference decides: `@workspace:` can appear inside a tarball URL.
  if (parts.reference.startsWith('workspace:')) return null

  const registry = registryVersionOf(locator)
  if (registry) return registry.name

  if (isBuiltinCompatPatch(parts.name, parts.reference)) return parts.name

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

/**
 * @param {string} base  The base branch's `yarn.lock`.
 * @param {string} head  The PR's `yarn.lock`.
 * @returns {string[]} `name@version` for every plain registry locator `head`
 *   pins that `base` does not, sorted. A version bump therefore shows up even
 *   though the package name is not new.
 */
export const changedVersions = (base, head) => {
  const versionsOf = (lockfile) => {
    const versions = new Set()
    for (const locator of resolutions(lockfile)) {
      const entry = registryVersionOf(locator)
      if (entry) versions.add(`${entry.name}@${entry.version}`)
    }
    return versions
  }
  const before = versionsOf(base)
  return [...versionsOf(head)].filter((version) => !before.has(version)).sort()
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop())
) {
  const { readFileSync } = await import('node:fs')
  const args = process.argv.slice(2)
  const changed = args[0] === '--changed-versions'
  const [basePath, headPath] = changed ? args.slice(1) : args
  if (!basePath || !headPath) {
    console.error(
      'usage: node lockfile-new-packages.mjs [--changed-versions] <base-lockfile> <head-lockfile>'
    )
    process.exit(1)
  }
  const list = changed ? changedVersions : newPackages
  for (const entry of list(
    readFileSync(basePath, 'utf8'),
    readFileSync(headPath, 'utf8')
  ))
    console.log(entry)
}
