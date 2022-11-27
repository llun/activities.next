/* eslint-disable @typescript-eslint/no-var-requires,no-undef */
require('jest-fetch-mock').enableMocks()
// changes default behavior of fetchMock to use the real 'fetch' implementation and not mock responses
fetchMock.dontMock()
