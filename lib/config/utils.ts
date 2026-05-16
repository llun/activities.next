export type EnvironmentListOptions = {
  onInvalidList?: 'empty' | 'throw'
}

export const matcher = (prefix: string) =>
  Object.keys(process.env).some((key: string) => key.startsWith(prefix))

const toStringList = (
  value: unknown,
  key: string,
  { onInvalidList = 'empty' }: EnvironmentListOptions = {}
): string[] => {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)

  if (onInvalidList === 'throw') {
    throw new Error(`${key} must be a JSON array`)
  }

  return []
}

export const getEnvironmentList = (
  key: string,
  { onInvalidList = 'empty' }: EnvironmentListOptions = {}
): string[] => {
  try {
    return toStringList(JSON.parse(process.env[key] || '[]'), key, {
      onInvalidList
    })
  } catch (error) {
    if (onInvalidList === 'throw') throw error
    return []
  }
}
