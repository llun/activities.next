// Move the item at `from` to `to`, returning a new array. Out-of-range or
// no-op moves return the original reference so callers can skip a re-render.
export const reorder = <T>(list: T[], from: number, to: number): T[] => {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list
  }
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
