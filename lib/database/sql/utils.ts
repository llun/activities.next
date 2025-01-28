export const getCompatibleTime = (time: any): number =>
  typeof time === 'number' ? time : time.getTime()
