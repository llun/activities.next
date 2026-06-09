const { MOCK_SECRET_PHASES } = jest.requireActual('../stub/actor')
const { TEST_DOMAIN } = jest.requireActual('../stub/const')

export const getConfig = jest.fn().mockReturnValue({
  host: TEST_DOMAIN,
  database: {},
  allowEmails: [],
  registrationOpen: true,
  secretPhase: MOCK_SECRET_PHASES,
  auth: {}
})

export const getBaseURL = jest.fn().mockReturnValue(`https://${TEST_DOMAIN}`)
