export const matcher = (prefix: string) =>
  Object.keys(process.env).some((key: string) => key.startsWith(prefix))
