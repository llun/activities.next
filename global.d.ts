import 'jest-extended'

declare module 'fit-file-parser' {
  export interface FitRecord {
    position_lat?: number
    position_long?: number
    altitude?: number
    timestamp?: Date | string
    distance?: number
    [key: string]: unknown
  }

  export interface FitSession {
    total_distance?: number
    total_elapsed_time?: number
    total_timer_time?: number
    total_ascent?: number
    sport?: string
    sub_sport?: string
    start_time?: Date | string
    [key: string]: unknown
  }

  export interface FitData {
    sessions?: FitSession[]
    records?: FitRecord[]
    [key: string]: unknown
  }

  export default class FitParser {
    constructor(options?: Record<string, unknown>)
    parse(
      buffer: ArrayBufferLike | Buffer<ArrayBufferLike>,
      callback: (error: Error | null, data?: FitData) => void
    ): void
  }
}
