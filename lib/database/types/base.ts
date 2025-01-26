export interface BaseStorage {
  migrate(): Promise<void>
  destroy(): Promise<void>
}
