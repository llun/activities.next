export interface BaseDatabase {
  migrate(): Promise<void>
  destroy(): Promise<void>
}
