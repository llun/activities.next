const BUMP_RANK = { none: 0, patch: 1, minor: 2, major: 3 }

const isVersionBumpCommit = (subject) =>
  /^Bump version to v\d+\.\d+\.\d+/.test(subject)

const explicitBump = (line, majorApproved) => {
  if (/^major:/.test(line)) return majorApproved ? 'major' : 'minor'
  if (/^minor:/.test(line)) return 'minor'
  return null
}

export const getCommitBump = ({
  subject,
  body,
  changedFiles,
  majorApproved = false
}) => {
  if (isVersionBumpCommit(subject)) return null

  const subjectBump = explicitBump(subject, majorApproved)
  if (subjectBump) return subjectBump
  if (/^none:/.test(subject)) return 'none'

  let bodyBump = null
  for (const line of body.split('\n')) {
    const lineBump = explicitBump(
      line.replace(/^[\s]*[-*][\s]+/, ''),
      majorApproved
    )

    if (lineBump === 'major') return 'major'
    if (lineBump === 'minor') bodyBump = 'minor'
  }
  if (bodyBump) return bodyBump

  return changedFiles.every((path) => path.startsWith('.github/'))
    ? 'none'
    : 'patch'
}

export const selectVersionBump = (commits) => {
  let bump = 'none'
  let commitCount = 0

  for (const commit of commits) {
    const commitBump = getCommitBump(commit)
    if (commitBump === null) continue

    commitCount += 1
    if (BUMP_RANK[commitBump] > BUMP_RANK[bump]) bump = commitBump
  }

  return { bump, commitCount }
}

export const nextVersion = (latestTag, bump) => {
  let [major, minor, patch] = latestTag.slice(1).split('.').map(Number)

  if (bump === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (bump === 'minor') {
    minor += 1
    patch = 0
  } else if (bump === 'patch') {
    patch += 1
  }

  return `${major}.${minor}.${patch}`
}

export const isMajorTransition = (previousTag, nextTag) =>
  Number(nextTag.slice(1).split('.')[0]) >
  Number(previousTag.slice(1).split('.')[0])
