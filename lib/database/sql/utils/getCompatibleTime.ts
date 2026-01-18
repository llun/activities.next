export const getCompatibleTime = (time: number | Date | string): number => {
  if (typeof time === 'number') return time
  if (typeof time === 'string') return new Date(time).getTime()
  return time.getTime()
}
