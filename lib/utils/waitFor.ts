export const waitFor = async (timeInMilliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, timeInMilliseconds))
