export const getCompatibleJSON = <T>(input: string | T) => {
  if (typeof input === 'string') {
    return JSON.parse(input) as T
  }
  return input ?? ({} as T)
}
