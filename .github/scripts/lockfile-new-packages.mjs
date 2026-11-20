// Lists the package names a Yarn Berry lockfile gained, so the Dependabot
// auto-merge workflow can leave a PR that pulls in a package the base branch
// never had for a human. Pure so it can be unit tested; the workflow reads
// both lockfiles with `git show` and runs this file from the base commit.
import console from 'node:console'
import process from 'node:process'

// A descriptor is `<name>@<protocol>:<range>`, e.g. `@scope/a@npm:^1.0.0` or
// `name@npm:^1.0.0`. The name ends at the `@` that starts the range; a scoped
// name starts with `@`, so its own `@` is skipped.
const nameOfDescriptor = (descriptor) => {
  const separator = descriptor.startsWith('@')
    ? descriptor.indexOf('@', 1)
    : descriptor.indexOf('@')
  if (separator <= 0) return null

  const name = descriptor.slice(0, separator)
  const range = descriptor.slice(separator + 1)
  // Workspace entries (`@workspace:packages/foo`) are not registry packages.
  if (range.startsWith('workspace:')) return null
  // An npm alias (`alias@npm:real@^1`) installs `real`, so that is the name
  // whose arrival matters.
  if (range.startsWith('npm:')) {
    const target = range.slice('npm:'.length)
    const aliasSeparator = target.startsWith('@')
      ? target.indexOf('@', 1)
      : target.indexOf('@')
    if (aliasSeparator > 0) return target.slice(0, aliasSeparator)
  }
  return name
}

// Top-level entry keys sit at column 0 and end with `:`; quoted keys end with
// `":`. `__metadata` has no descriptor and is skipped by `nameOfDescriptor`.
const entryKeys = (lockfile) =>
  lockfile
    .split('\n')
    .filter((line) => /^[^\s#].*:$/.test(line))
    .map((line) =>
      line.startsWith('"') ? line.slice(1, -2) : line.slice(0, -1)
    )

/**
 * @param {string} lockfile  A Yarn Berry `yarn.lock` text.
 * @returns {Set<string>} Every package name the lockfile resolves.
 */
export const packageNames = (lockfile) => {
  const names = new Set()
  for (const key of entryKeys(lockfile)) {
    for (const descriptor of key.split(', ')) {
      const name = nameOfDescriptor(descriptor.trim())
      if (name) names.add(name)
    }
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
