export interface Session {
  token: string
  accountId: string
  expireAt: number

  createdAt: number
  updatedAt: number
}
