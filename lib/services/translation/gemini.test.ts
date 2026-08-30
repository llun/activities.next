import { GeminiTranslationConfig } from '@/lib/config/translation'
import {
  TranslationHttpClient,
  TranslationHttpRequest
} from '@/lib/services/translation/types'

import { createGeminiProvider } from './gemini'

const BASE_CONFIG: GeminiTranslationConfig = {
  type: 'gemini',
  apiKey: 'gemini-secret-key',
  model: 'gemini-2.5-flash',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta'
}

describe('createGeminiProvider', () => {
  it('translates posts and detects source language', async () => {
    let capturedRequest: TranslationHttpRequest | undefined
    const httpClient: TranslationHttpClient = async (request) => {
      capturedRequest = request
      return {
        statusCode: 200,
        body: JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      translations: ['<p>Hola mundo</p>'],
                      detected_source_language: 'en'
                    })
                  }
                ]
              }
            }
          ]
        })
      }
    }

    const provider = createGeminiProvider(BASE_CONFIG, httpClient)
    const result = await provider.translate(['<p>Hello world</p>'], 'es')

    expect(result).toEqual({
      texts: ['<p>Hola mundo</p>'],
      detectedSourceLanguage: 'en',
      provider: 'gemini-2.5-flash'
    })

    expect(capturedRequest?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    )
    expect(capturedRequest?.headers).toEqual({
      'x-goog-api-key': 'gemini-secret-key',
      'Content-Type': 'application/json'
    })
    const body = JSON.parse(capturedRequest?.body as string)
    expect(body.generationConfig).toEqual({
      temperature: 0,
      responseMimeType: 'application/json'
    })
  })

  it('exposes supported languages for source and target', async () => {
    const provider = createGeminiProvider(BASE_CONFIG)
    const languages = await provider.languages()

    expect(languages.source).toContain('en')
    expect(languages.source).toContain('ja')
    expect(languages.target).toEqual(languages.source)
  })

  it('throws TranslationProviderError on non-200 responses', async () => {
    const httpClient: TranslationHttpClient = async () => ({
      statusCode: 403,
      body: '{"error":{"message":"API key not valid"}}'
    })

    const provider = createGeminiProvider(BASE_CONFIG, httpClient)
    await expect(provider.translate(['Hello'], 'es')).rejects.toThrow(
      /Gemini translate request failed with status 403/
    )
  })

  it('throws TranslationProviderError when candidate content is missing', async () => {
    const httpClient: TranslationHttpClient = async () => ({
      statusCode: 200,
      body: JSON.stringify({ candidates: [] })
    })

    const provider = createGeminiProvider(BASE_CONFIG, httpClient)
    await expect(provider.translate(['Hello'], 'es')).rejects.toThrow(
      /Gemini translation response was empty/
    )
  })

  it('throws TranslationProviderError on malformed JSON payload', async () => {
    const httpClient: TranslationHttpClient = async () => ({
      statusCode: 200,
      body: JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'not json' }]
            }
          }
        ]
      })
    })

    const provider = createGeminiProvider(BASE_CONFIG, httpClient)
    await expect(provider.translate(['Hello'], 'es')).rejects.toThrow(
      /LLM translation response was not valid JSON/
    )
  })

  it('throws TranslationProviderError when translations length mismatches inputs', async () => {
    const httpClient: TranslationHttpClient = async () => ({
      statusCode: 200,
      body: JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    translations: ['one'],
                    detected_source_language: 'en'
                  })
                }
              ]
            }
          }
        ]
      })
    })

    const provider = createGeminiProvider(BASE_CONFIG, httpClient)
    await expect(provider.translate(['one', 'two'], 'es')).rejects.toThrow(
      /LLM translation response had an unexpected shape/
    )
  })
})
