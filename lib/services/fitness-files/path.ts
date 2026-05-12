import path from 'path'

export const resolveFitnessStoragePath = (
  storageRootPath: string,
  filePath: string
): string | null => {
  const storageRoot = path.resolve(storageRootPath)
  const fullPath = path.resolve(storageRoot, filePath)
  const storageRootPrefix = storageRoot.endsWith(path.sep)
    ? storageRoot
    : `${storageRoot}${path.sep}`

  if (fullPath !== storageRoot && !fullPath.startsWith(storageRootPrefix)) {
    return null
  }

  return fullPath
}

export const assertFitnessStoragePath = (
  storageRootPath: string,
  filePath: string
): string => {
  const fullPath = resolveFitnessStoragePath(storageRootPath, filePath)
  if (!fullPath) {
    throw new Error('Fitness storage path escapes storage root')
  }
  return fullPath
}
