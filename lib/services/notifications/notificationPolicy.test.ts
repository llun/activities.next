import { NextRequest } from 'next/server'

import { readNotificationPolicyBody } from './notificationPolicy'

describe('readNotificationPolicyBody', () => {
  it('falls back to an empty object for an unreadable body', async () => {
    const req = new NextRequest('https://llun.test/api', {
      method: 'PATCH',
      body: 'not json'
    })

    await expect(readNotificationPolicyBody(req)).resolves.toEqual({})
  })
})
