export const getFirstValueFromParsedQuery = <T>(value: T | T[] | undefined) => {
  if (!value) return value
  if (Array.isArray(value)) return value.slice().shift()
  return value
}
