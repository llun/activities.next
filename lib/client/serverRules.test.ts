import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  type ServerRule,
  type ServerRuleInput,
  createServerRule,
  deleteServerRule,
  getServerRules,
  updateServerRule
} from './serverRules'

describe('serverRules client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  const mockRule: ServerRule = {
    id: 'rule-1',
    text: 'Be respectful',
    hint: 'Treat everyone with kindness',
    position: 0
  }

  describe('getServerRules', () => {
    it('fetches and returns rules on successful response', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockRule]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const result = await getServerRules()

      expect(result).toEqual([mockRule])
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/rules', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })

    it('throws when response is not ok', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      await expect(getServerRules()).rejects.toThrow(
        'Failed to load rules (500)'
      )
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/rules', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })
  })

  describe('createServerRule', () => {
    const input: ServerRuleInput = {
      text: 'No spam',
      hint: 'Do not post unsolicited commercial content',
      position: 1
    }

    it('creates rule and returns ServerRule on successful response', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockRule), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const result = await createServerRule(input)

      expect(result).toEqual(mockRule)
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
    })

    it('returns null when response is not ok', async () => {
      fetchMock.mockResponseOnce('Unprocessable Entity', { status: 422 })

      const result = await createServerRule(input)

      expect(result).toBeNull()
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
    })
  })

  describe('updateServerRule', () => {
    const input: Partial<ServerRuleInput> = {
      text: 'Updated rule text'
    }

    it('updates rule and returns ServerRule on successful response', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ ...mockRule, text: 'Updated rule text' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )

      const result = await updateServerRule('rule-1', input)

      expect(result).toEqual({ ...mockRule, text: 'Updated rule text' })
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/rules/rule-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
    })

    it('escapes rule id with special characters', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockRule), { status: 200 })

      await updateServerRule('rule/with spaces', input)

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/rules/rule%2Fwith%20spaces',
        expect.objectContaining({ method: 'PUT' })
      )
    })

    it('returns null when response is not ok', async () => {
      fetchMock.mockResponseOnce('Not Found', { status: 404 })

      const result = await updateServerRule('rule-1', input)

      expect(result).toBeNull()
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/rules/rule-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
    })
  })

  describe('deleteServerRule', () => {
    it('deletes rule and returns true on successful response', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const result = await deleteServerRule('rule-1')

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/rules/rule-1', {
        method: 'DELETE'
      })
    })

    it('escapes rule id with special characters', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      await deleteServerRule('rule/with spaces')

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/rules/rule%2Fwith%20spaces',
        { method: 'DELETE' }
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce('Not Found', { status: 404 })

      const result = await deleteServerRule('rule-1')

      expect(result).toBe(false)
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/rules/rule-1', {
        method: 'DELETE'
      })
    })
  })
})
