import { Account } from './account'

export interface Actor {
  id: string
  preferredUsername: string
  summary: string

  account?: Account
  following?: Actor

  manuallyApprovesFollowers: boolean
  discoverable: boolean

  publicKey: string
  privateKey: string

  createdAt: number
  updatedAt?: number
}
