export const DELIVERY_FAILURE_DAYS_THRESHOLD = 7
export const MAX_DELIVERY_LAST_ERROR_LENGTH = 255

export type RecordDeliveryFailureParams = {
  domain: string
  error?: string | null
  now?: number | Date
}

export type ClearDeliveryFailuresParams = {
  domain: string
}

export type GetUnavailableDomainsParams = {
  domains: string[]
}

export type IsDomainUnavailableParams = {
  domain: string
}

export interface DeliveryDomainsDatabase {
  recordDeliveryFailure(params: RecordDeliveryFailureParams): Promise<boolean>
  clearDeliveryFailures(params: ClearDeliveryFailuresParams): Promise<void>
  getUnavailableDomains(params: GetUnavailableDomainsParams): Promise<string[]>
  isDomainUnavailable(params: IsDomainUnavailableParams): Promise<boolean>
}
