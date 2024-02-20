import { headerHost } from "../services/guards/headerHost"

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD'

export const getCORSHeaders = (method: HttpMethod, headers: Headers) => ({
  'Access-Control-Allow-Methods': method,
  'Access-Control-Allow-Origin':
    headers.get('origin') ?? `https://${headerHost(headers)}`
})
