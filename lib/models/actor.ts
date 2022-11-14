export interface Actor {
  handle: string
  summary: string

  manuallyApprovesFollowers: boolean
  discoverable: boolean

  publicKey: string
  privateKey: string

  createdAt: number
  updatedAt?: number
}
