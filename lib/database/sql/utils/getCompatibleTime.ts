export const getCompatibleTime = (time: number | Date): number =>
  typeof time === 'number' ? time : time.getTime()
