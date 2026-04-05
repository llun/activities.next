import { getHTMLContent, getSubject, getTextContent } from './activityImport'

describe('activityImport email template', () => {
  describe('#getSubject', () => {
    it('returns subject with host', () => {
      const result = getSubject()
      expect(result).toMatch(/Your fitness activity was imported in/)
    })
  })

  describe('#getTextContent', () => {
    it('returns text content about the import', () => {
      const result = getTextContent()
      expect(result).toContain('Strava fitness activity has been imported')
    })
  })

  describe('#getHTMLContent', () => {
    it('returns HTML content about the import', () => {
      const result = getHTMLContent()
      expect(result).toContain('Strava fitness activity has been imported')
      expect(result).toContain('<p>')
    })
  })
})
