export interface Provider {
  id: string
  name: string
  type: string
  signinUrl?: string
  callbackUrl: string
}

export interface ProviderMap {
  [key: string]: Provider
}
