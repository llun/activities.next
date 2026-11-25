import { Secp256k1Keypair } from '@atproto/crypto'

import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  PLC_DIRECTORY_MAX_BODY_BYTES,
  PLC_DIRECTORY_TIMEOUT_MS,
  PlcDirectoryError,
  cidForOperation,
  createGenesisOperation,
  createUpdateOperation,
  didForGenesisOperation,
  getLastPlcOperation,
  getPlcData,
  signPlcOperation,
  submitPlcOperation,
  verifyPlcOperationSignature
} from './plc'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

const FIXED_PRIVATE_KEY = Buffer.from(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'hex'
)
const OTHER_PRIVATE_KEY = Buffer.from(
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  'hex'
)

const DID = 'did:plc:abcdefghijklmnopqrstuvwx'
const DIRECTORY = 'https://plc.example.com'

const okResponse = (url: string, body = '', statusCode = 200) => ({
  body,
  bodyTruncated: false,
  headers: {},
  statusCode,
  url
})

const loadKeypair = (bytes: Buffer): Promise<Secp256k1Keypair> =>
  Secp256k1Keypair.import(bytes)

describe('PLC operations', () => {
  it('signs an operation and verifies it with the right key only', async () => {
    const keypair = await loadKeypair(FIXED_PRIVATE_KEY)
    const other = await loadKeypair(OTHER_PRIVATE_KEY)

    const signed = await signPlcOperation(
      {
        type: 'plc_operation',
        rotationKeys: [keypair.did()],
        verificationMethods: { atproto: keypair.did() },
        alsoKnownAs: ['at://alice.example.com'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: 'https://pds.example.com'
          }
        },
        prev: null
      },
      keypair
    )

    expect(signed.sig).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(signed.sig).not.toContain('=')
    expect(await verifyPlcOperationSignature(signed, [keypair.did()])).toBe(
      true
    )
    expect(await verifyPlcOperationSignature(signed, [other.did()])).toBe(false)
    expect(
      await verifyPlcOperationSignature(signed, [other.did(), keypair.did()])
    ).toBe(true)
  })

  it('derives a deterministic did:plc of the documented shape from a genesis operation', async () => {
    const keypair = await loadKeypair(FIXED_PRIVATE_KEY)
    const params = {
      rotationKeys: [keypair.did()],
      signingKeyDid: 'did:key:zQ3shSigningKey',
      handle: 'alice.example.com',
      pdsEndpoint: 'https://pds.example.com',
      rotationKeypair: keypair
    }

    const first = await createGenesisOperation(params)
    const second = await createGenesisOperation(params)

    expect(first.did).toBe(second.did)
    expect(first.did).toMatch(/^did:plc:[a-z2-7]{24}$/)
    expect(first.did).toBe(await didForGenesisOperation(first.operation))
    expect(first.operation.prev).toBeNull()
    expect(first.operation.alsoKnownAs).toEqual(['at://alice.example.com'])
    expect(first.operation.verificationMethods).toEqual({
      atproto: 'did:key:zQ3shSigningKey'
    })
    expect(first.operation.services).toEqual({
      atproto_pds: {
        type: 'AtprotoPersonalDataServer',
        endpoint: 'https://pds.example.com'
      }
    })
  })

  it('refuses a genesis operation whose keypair is not a rotation key', async () => {
    const keypair = await loadKeypair(FIXED_PRIVATE_KEY)
    const other = await loadKeypair(OTHER_PRIVATE_KEY)

    await expect(
      createGenesisOperation({
        rotationKeys: [other.did()],
        signingKeyDid: 'did:key:zQ3shSigningKey',
        handle: 'alice.example.com',
        pdsEndpoint: 'https://pds.example.com',
        rotationKeypair: keypair
      })
    ).rejects.toThrow('rotation key')
  })

  it('chains an update to the previous operation CID and keeps the other fields', async () => {
    const keypair = await loadKeypair(FIXED_PRIVATE_KEY)
    const genesis = await createGenesisOperation({
      rotationKeys: [keypair.did()],
      signingKeyDid: 'did:key:zQ3shSigningKey',
      handle: 'alice.example.com',
      pdsEndpoint: 'https://pds.example.com',
      rotationKeypair: keypair
    })
    const genesisCid = await cidForOperation(genesis.operation)
    expect(genesisCid).toMatch(/^bafyrei/)

    const update = await createUpdateOperation({
      previous: genesis.operation,
      previousCid: genesisCid,
      changes: { alsoKnownAs: ['at://bob.example.com'] },
      rotationKeypair: keypair
    })

    expect(update.prev).toBe(genesisCid)
    expect(update.alsoKnownAs).toEqual(['at://bob.example.com'])
    expect(update.rotationKeys).toEqual(genesis.operation.rotationKeys)
    expect(update.verificationMethods).toEqual(
      genesis.operation.verificationMethods
    )
    expect(update.services).toEqual(genesis.operation.services)
    expect(
      await verifyPlcOperationSignature(update, genesis.operation.rotationKeys)
    ).toBe(true)

    // The update's own CID is what the next operation would chain to.
    const updateCid = await cidForOperation(update)
    expect(updateCid).not.toBe(genesisCid)
  })
})

describe('PLC directory client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const signedOperation = async () => {
    const keypair = await loadKeypair(FIXED_PRIVATE_KEY)
    return signPlcOperation(
      {
        type: 'plc_operation',
        rotationKeys: [keypair.did()],
        verificationMethods: { atproto: keypair.did() },
        alsoKnownAs: ['at://alice.example.com'],
        services: {
          atproto_pds: {
            type: 'AtprotoPersonalDataServer',
            endpoint: 'https://pds.example.com'
          }
        },
        prev: null
      },
      keypair
    )
  }

  it('POSTs the operation as JSON to the directory DID URL', async () => {
    const operation = await signedOperation()
    vi.mocked(safeRemoteFetch).mockResolvedValueOnce(
      okResponse(`${DIRECTORY}/${DID}`)
    )

    await submitPlcOperation(DID, operation, { directory: DIRECTORY })

    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    expect(safeRemoteFetch).toHaveBeenCalledWith({
      url: `${DIRECTORY}/${DID}`,
      method: 'POST',
      maxRedirects: 0,
      maxBodyBytes: PLC_DIRECTORY_MAX_BODY_BYTES,
      timeoutInMilliseconds: PLC_DIRECTORY_TIMEOUT_MS,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(operation)
    })
  })

  it('throws a typed error carrying the status and directory message, never the request body', async () => {
    const operation = await signedOperation()
    vi.mocked(safeRemoteFetch).mockResolvedValueOnce(
      okResponse(
        `${DIRECTORY}/${DID}`,
        JSON.stringify({ error: 'Invalid signature' }),
        400
      )
    )

    const error = await submitPlcOperation(DID, operation, {
      directory: DIRECTORY
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PlcDirectoryError)
    const plcError = error as PlcDirectoryError
    expect(plcError.statusCode).toBe(400)
    expect(plcError.directoryMessage).toBe('Invalid signature')
    expect(plcError.message).toContain('Invalid signature')
    expect(plcError.message).not.toContain(operation.sig)
    expect(plcError.message).not.toContain('alice.example.com')
  })

  it('turns an unreachable directory into a PLC directory error', async () => {
    const operation = await signedOperation()
    vi.mocked(safeRemoteFetch).mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND plc.example.com'), {
        code: 'ENOTFOUND'
      })
    )

    const error = await submitPlcOperation(DID, operation, {
      directory: DIRECTORY
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PlcDirectoryError)
    expect((error as PlcDirectoryError).statusCode).toBe(0)
    expect((error as Error).cause).toBeInstanceOf(Error)
  })

  it('refuses a non-https directory without calling the network', async () => {
    const operation = await signedOperation()

    await expect(
      submitPlcOperation(DID, operation, {
        directory: 'http://plc.example.com'
      })
    ).rejects.toBeInstanceOf(PlcDirectoryError)
    await expect(
      submitPlcOperation(DID, operation, {
        directory: 'https://plc.example.com/path'
      })
    ).rejects.toBeInstanceOf(PlcDirectoryError)
    expect(safeRemoteFetch).not.toHaveBeenCalled()
  })

  it('fetches and parses the last operation', async () => {
    const operation = await signedOperation()
    vi.mocked(safeRemoteFetch).mockResolvedValueOnce(
      okResponse(`${DIRECTORY}/${DID}/log/last`, JSON.stringify(operation))
    )

    await expect(
      getLastPlcOperation(DID, { directory: DIRECTORY })
    ).resolves.toEqual(operation)
    expect(safeRemoteFetch).toHaveBeenCalledWith({
      url: `${DIRECTORY}/${DID}/log/last`,
      method: 'GET',
      maxRedirects: 0,
      maxBodyBytes: PLC_DIRECTORY_MAX_BODY_BYTES,
      timeoutInMilliseconds: PLC_DIRECTORY_TIMEOUT_MS
    })
  })

  it('fetches and parses the PLC data', async () => {
    const data = {
      did: DID,
      rotationKeys: ['did:key:zQ3shRotation'],
      verificationMethods: { atproto: 'did:key:zQ3shSigning' },
      alsoKnownAs: ['at://alice.example.com'],
      services: {
        atproto_pds: {
          type: 'AtprotoPersonalDataServer',
          endpoint: 'https://pds.example.com'
        }
      }
    }
    vi.mocked(safeRemoteFetch).mockResolvedValueOnce(
      okResponse(`${DIRECTORY}/${DID}/data`, JSON.stringify(data))
    )

    await expect(getPlcData(DID, { directory: DIRECTORY })).resolves.toEqual(
      data
    )
  })

  it('rejects an invalid DID and an invalid operation response', async () => {
    await expect(
      getPlcData('did:web:example.com', { directory: DIRECTORY })
    ).rejects.toBeInstanceOf(PlcDirectoryError)

    vi.mocked(safeRemoteFetch).mockResolvedValueOnce(
      okResponse(`${DIRECTORY}/${DID}/log/last`, JSON.stringify({ nope: true }))
    )
    await expect(
      getLastPlcOperation(DID, { directory: DIRECTORY })
    ).rejects.toBeInstanceOf(PlcDirectoryError)
  })
})
