const { MOCK_SECRET_PHASES } = jest.requireActual('../stub/actor')
const { TEST_DOMAIN } = jest.requireActual('../stub/const')

export const getConfig = jest.fn().mockReturnValue({
  host: TEST_DOMAIN,
  database: {},
  allowEmails: [],
  secretPhase: MOCK_SECRET_PHASES,
  auth: {}
})
