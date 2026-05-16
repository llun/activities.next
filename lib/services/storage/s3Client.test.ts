import { normalizeStorageEndpoint } from '@/lib/services/storage/s3Client'

describe('normalizeStorageEndpoint', () => {
  it('normalizes plain local endpoints without requiring a protocol', () => {
    expect(normalizeStorageEndpoint('localhost:9000')).toBe(
      'https://localhost:9000'
    )
    expect(normalizeStorageEndpoint('127.0.0.1')).toBe('https://127.0.0.1')
  })

  it('preserves custom endpoint path segments', () => {
    expect(normalizeStorageEndpoint('https://storage.example.com/s3/')).toBe(
      'https://storage.example.com/s3'
    )
    expect(normalizeStorageEndpoint('storage.example.com/s3')).toBe(
      'https://storage.example.com/s3'
    )
  })
})
