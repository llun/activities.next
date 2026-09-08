import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AdminReport } from '@/lib/types/mastodon/admin/report'

import {
  assignAdminReportToSelf,
  getAdminReport,
  getAdminReports,
  reopenAdminReport,
  resolveAdminReport,
  unassignAdminReport,
  updateAdminReport
} from './adminReports'

describe('adminReports client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  const mockAdminReport: AdminReport = {
    id: 'report-1',
    action_taken: false,
    action_taken_at: null,
    category: 'spam',
    comment: 'spamming links',
    forwarded: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    account: {} as AdminReport['account'],
    target_account: {} as AdminReport['target_account'],
    assigned_account: null,
    action_taken_by_account: null,
    statuses: [],
    rules: []
  }

  describe('getAdminReports', () => {
    it('fetches reports without query param when resolved is undefined', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockAdminReport]), {
        status: 200
      })

      const result = await getAdminReports()

      expect(result).toEqual([mockAdminReport])
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/reports', {
        headers: { Accept: 'application/json' },
        credentials: 'include'
      })
    })

    it('fetches reports with resolved=true', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockAdminReport]), {
        status: 200
      })

      await getAdminReports(true)

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/reports?resolved=true',
        {
          headers: { Accept: 'application/json' },
          credentials: 'include'
        }
      )
    })

    it('fetches reports with resolved=false', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockAdminReport]), {
        status: 200
      })

      await getAdminReports(false)

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/reports?resolved=false',
        {
          headers: { Accept: 'application/json' },
          credentials: 'include'
        }
      )
    })

    it('throws error when response is not ok', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(getAdminReports()).rejects.toThrow(
        'Failed to load admin reports'
      )
    })
  })

  describe('getAdminReport', () => {
    it('fetches report by id', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockAdminReport), {
        status: 200
      })

      const result = await getAdminReport('report-1')

      expect(result).toEqual(mockAdminReport)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/reports/report-1', {
        headers: { Accept: 'application/json' },
        credentials: 'include'
      })
    })

    it('throws error when response is not ok', async () => {
      fetchMock.mockResponseOnce('', { status: 404 })

      await expect(getAdminReport('report-1')).rejects.toThrow(
        'Failed to load admin report'
      )
    })
  })

  describe('updateAdminReport', () => {
    it('sends PUT request with category and ruleIds', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockAdminReport), {
        status: 200
      })

      const result = await updateAdminReport({
        id: 'report-1',
        category: 'violation',
        ruleIds: ['rule-1', 'rule-2']
      })

      expect(result).toEqual(mockAdminReport)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/reports/report-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          category: 'violation',
          rule_ids: ['rule-1', 'rule-2']
        })
      })
    })

    it('throws custom error message from response', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Invalid report category' }),
        { status: 422 }
      )

      await expect(
        updateAdminReport({ id: 'report-1', category: 'spam' })
      ).rejects.toThrow('Invalid report category')
    })

    it('throws fallback error when response has no error payload', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      await expect(
        updateAdminReport({ id: 'report-1', category: 'spam' })
      ).rejects.toThrow('Failed to update report')
    })
  })

  describe('admin report actions', () => {
    const actions = [
      {
        name: 'assignAdminReportToSelf',
        fn: assignAdminReportToSelf,
        endpoint: 'assign_to_self'
      },
      {
        name: 'unassignAdminReport',
        fn: unassignAdminReport,
        endpoint: 'unassign'
      },
      {
        name: 'resolveAdminReport',
        fn: resolveAdminReport,
        endpoint: 'resolve'
      },
      { name: 'reopenAdminReport', fn: reopenAdminReport, endpoint: 'reopen' }
    ]

    for (const { name, fn, endpoint } of actions) {
      it(`${name} calls endpoint and returns report`, async () => {
        fetchMock.mockResponseOnce(JSON.stringify(mockAdminReport), {
          status: 200
        })

        const result = await fn('report-1')

        expect(result).toEqual(mockAdminReport)
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/v1/admin/reports/report-1/${endpoint}`,
          {
            method: 'POST',
            credentials: 'include'
          }
        )
      })

      it(`${name} throws error when request fails`, async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({ error: `Could not ${endpoint}` }),
          { status: 400 }
        )

        await expect(fn('report-1')).rejects.toThrow(`Could not ${endpoint}`)
      })
    }
  })
})
