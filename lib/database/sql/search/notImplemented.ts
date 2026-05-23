export const throwUnimplementedSearchMethod = (method: string): never => {
  throw new Error(`not implemented: ${method}`)
}
