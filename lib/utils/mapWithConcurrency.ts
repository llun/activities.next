export const mapWithConcurrency = async <T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>
): Promise<TResult[]> => {
  const results: TResult[] = []

  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency)
    results.push(...(await Promise.all(chunk.map(mapper))))
  }

  return results
}
