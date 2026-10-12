export const isUniqueConstraintError = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false

  const { code, message } = error as Record<string, unknown>
  const errorCode = typeof code === 'string' ? code : undefined
  const errorMessage = typeof message === 'string' ? message : undefined

  return (
    errorCode === '23505' ||
    errorCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    Boolean(errorMessage?.includes('UNIQUE constraint failed'))
  )
}
