export const isUniqueConstraintError = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false

  const { code, errno, message } = error as Record<string, unknown>
  const errorCode = typeof code === 'string' ? code : undefined
  const errorNumber = typeof errno === 'number' ? errno : undefined
  const errorMessage = typeof message === 'string' ? message : undefined

  return (
    errorCode === '23505' ||
    errorCode === 'ER_DUP_ENTRY' ||
    errorCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    errorNumber === 1062 ||
    Boolean(errorMessage?.includes('UNIQUE constraint failed'))
  )
}
