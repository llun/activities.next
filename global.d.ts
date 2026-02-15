import 'jest-extended'

declare module 'fit-file-parser' {
  export default class FitParser {
    constructor(options?: Record<string, unknown>)
    parse(
      buffer: Buffer,
      callback: (error: Error | null, data?: unknown) => void
    ): void
  }
}
