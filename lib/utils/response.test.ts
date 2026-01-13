import {
  DEFAULT_200,
  DEFAULT_202,
  ERROR_400,
  ERROR_401,
  ERROR_403,
  ERROR_404,
  ERROR_422,
  ERROR_500,
  HTTP_STATUS,
  codeMap,
  defaultStatusOption,
  statusText
} from './response'

describe('response utilities', () => {
  describe('error constants', () => {
    it('has correct error status messages', () => {
      expect(ERROR_400).toEqual({ status: 'Bad Request' })
      expect(ERROR_401).toEqual({ status: 'Unauthorized' })
      expect(ERROR_403).toEqual({ status: 'Forbidden' })
      expect(ERROR_404).toEqual({ status: 'Not Found' })
      expect(ERROR_422).toEqual({ status: 'Unprocessable entity' })
      expect(ERROR_500).toEqual({ status: 'Internal Server Error' })
    })

    it('has correct success status messages', () => {
      expect(DEFAULT_200).toEqual({ status: 'OK' })
      expect(DEFAULT_202).toEqual({ status: 'Accepted' })
    })
  })

  describe('HTTP_STATUS', () => {
    it('has correct status codes', () => {
      expect(HTTP_STATUS.OK).toEqual(200)
      expect(HTTP_STATUS.ACCEPTED).toEqual(202)
      expect(HTTP_STATUS.BAD_REQUEST).toEqual(400)
      expect(HTTP_STATUS.UNAUTHORIZED).toEqual(401)
      expect(HTTP_STATUS.FORBIDDEN).toEqual(403)
      expect(HTTP_STATUS.NOT_FOUND).toEqual(404)
      expect(HTTP_STATUS.UNPROCESSABLE_ENTITY).toEqual(422)
      expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toEqual(500)
    })
  })

  describe('codeMap', () => {
    it('maps status codes to responses', () => {
      expect(codeMap[200]).toEqual(DEFAULT_200)
      expect(codeMap[202]).toEqual(DEFAULT_202)
      expect(codeMap[400]).toEqual(ERROR_400)
      expect(codeMap[401]).toEqual(ERROR_401)
      expect(codeMap[403]).toEqual(ERROR_403)
      expect(codeMap[404]).toEqual(ERROR_404)
      expect(codeMap[422]).toEqual(ERROR_422)
      expect(codeMap[500]).toEqual(ERROR_500)
    })
  })

  describe('#statusText', () => {
    it('returns status text for known codes', () => {
      expect(statusText(200)).toEqual('OK')
      expect(statusText(404)).toEqual('Not Found')
      expect(statusText(500)).toEqual('Internal Server Error')
    })
  })

  describe('#defaultStatusOption', () => {
    it('returns object with status and statusText', () => {
      expect(defaultStatusOption(200)).toEqual({
        status: 200,
        statusText: 'OK'
      })
      expect(defaultStatusOption(404)).toEqual({
        status: 404,
        statusText: 'Not Found'
      })
    })
  })
})
