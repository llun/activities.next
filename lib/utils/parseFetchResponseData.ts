export const parseFetchResponseData = async (response: Response) => {
  const text = await response.text()
  if (!text) return {}

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { error: text }
  }
}
