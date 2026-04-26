export const getAuthErrorMessage = (
  error: { message?: unknown } | null | undefined,
  fallback: string
): string => (typeof error?.message === 'string' ? error.message : fallback)
