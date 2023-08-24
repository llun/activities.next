export interface Account {
  id: string
  email: string
  passwordHash: string
  verificationCode?: string

  createdAt: number
  updatedAt: number
  verifiedAt?: number
}
