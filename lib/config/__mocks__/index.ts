const { MOCK_SECRET_PHASES } =
  await vi.importActual<typeof import('@/lib/stub/actor')>('@/lib/stub/actor')
const { TEST_DOMAIN } =
  await vi.importActual<typeof import('@/lib/stub/const')>('@/lib/stub/const')
const photoEditor = await vi.importActual<
  typeof import('@/lib/config/photoEditor')
>('@/lib/config/photoEditor')

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
