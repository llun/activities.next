const { MOCK_SECRET_PHASES } =
  await vi.importActual<typeof import('@/lib/stub/actor')>('@/lib/stub/actor')
const { TEST_DOMAIN } =
  await vi.importActual<typeof import('@/lib/stub/const')>('@/lib/stub/const')
const webVitals = await vi.importActual<
  typeof import('@/lib/config/webVitals')
>('@/lib/config/webVitals')
const photoEditor = await vi.importActual<
  typeof import('@/lib/config/photoEditor')
>('@/lib/config/photoEditor')
const blueskyPds = await vi.importActual<
  typeof import('@/lib/config/blueskyPds')
>('@/lib/config/blueskyPds')

export const getConfig = vi.fn().mockReturnValue({
  host: TEST_DOMAIN,
  database: {},
  allowEmails: [],
  registrationOpen: true,
  secretPhase: MOCK_SECRET_PHASES,
  auth: {}
})

export const getBaseURL = vi.fn().mockReturnValue(`https://${TEST_DOMAIN}`)

// Reads the environment like the real one, without the warning.
export const getPhotoEditorConfig = vi.fn(() =>
  photoEditor.getPhotoEditorConfig()
)

export const getWebVitalsConfig = vi.fn(() => webVitals.getWebVitalsConfig())

export const getPdsConfig = vi.fn(
  () =>
    (getConfig() as { blueskyPds?: typeof blueskyPds.BlueskyPdsConfig._output })
      .blueskyPds ?? null
)

export const getPdsDomainForHostname = vi.fn(
  (hostname: string | null | undefined) =>
    blueskyPds.getPdsDomainForHostname(hostname, getPdsConfig())
)

export const isPdsAllowed = vi.fn(
  (params: {
    email?: string | null
    actorUsernameAtDomain?: string | null
    domain: string
  }) => blueskyPds.isPdsAllowed({ ...params, config: getPdsConfig() })
)
