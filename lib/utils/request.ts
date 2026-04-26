import got, { Headers, Method, OptionsInit } from 'got'
import { Buffer } from 'node:buffer'

import { getConfig } from '@/lib/config'
import packageJson from '@/package.json'

const USER_AGENT = `activities.next/${packageJson.version}`
const DEFAULT_RESPONSE_TIMEOUT = 10000
const MAX_RETRY_LIMIT = 1

const SHARED_HEADERS = {
  'User-Agent': USER_AGENT
}

export interface RequestOptions {
  url: string
  method?: Method
  headers?: Headers
  body?: string
  responseTimeout?: number
  numberOfRetry?: number
  maxResponseSize?: number
}

export interface RequestResult {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

const getGotOptions = ({
  method = 'GET',
  headers,
  body,
  responseTimeout,
  numberOfRetry
}: Omit<RequestOptions, 'url' | 'maxResponseSize'>): OptionsInit => {
  const config = getConfig()
  const retryLimit = config.request?.numberOfRetry ?? MAX_RETRY_LIMIT
  const retryNoise = config.request?.retryNoise
  const defaultResponseTimeout =
    responseTimeout ||
    config.request?.timeoutInMilliseconds ||
    DEFAULT_RESPONSE_TIMEOUT

  return {
    headers: {
      ...SHARED_HEADERS,
      ...headers
    },
    timeout: {
      request: defaultResponseTimeout
    },
    retry: {
      limit: typeof numberOfRetry === 'number' ? numberOfRetry : retryLimit,
      ...(typeof retryNoise === 'number' ? { noise: retryNoise } : null)
    },
    throwHttpErrors: false,
    method: method as Method,
    body
  }
}

const requestWithResponseSizeLimit = (
  url: string,
  options: OptionsInit,
  maxResponseSize: number
): Promise<RequestResult> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bodyBytes = 0
    let statusCode = 0
    let headers: Record<string, string | string[] | undefined> = {}
    const stream = got.stream(url, options)

    stream.on('response', (response) => {
      statusCode = response.statusCode
      headers = response.headers
    })
    stream.on('data', (chunk) => {
      const buffer = Buffer.from(chunk)
      bodyBytes += buffer.byteLength

      if (bodyBytes > maxResponseSize) {
        stream.destroy(new Error('Response body too large'))
        return
      }

      chunks.push(buffer)
    })
    stream.on('end', () => {
      resolve({
        statusCode,
        headers,
        body: Buffer.concat(chunks).toString('utf8')
      })
    })
    stream.on('error', reject)
  })

export const request = ({
  url,
  method = 'GET',
  headers,
  body,
  responseTimeout,
  numberOfRetry,
  maxResponseSize
}: RequestOptions) => {
  const options = getGotOptions({
    method,
    headers,
    body,
    responseTimeout,
    numberOfRetry
  })

  if (typeof maxResponseSize === 'number') {
    return requestWithResponseSizeLimit(url, options, maxResponseSize)
  }

  return got(url, options)
}
