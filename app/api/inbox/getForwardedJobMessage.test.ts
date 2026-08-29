import { getForwardedJobMessage } from '@/app/api/inbox/getForwardedJobMessage'
import { StatusActivity } from '@/lib/activities/statusAction'
import { PROCESS_FORWARDED_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { getHashFromString } from '@/lib/utils/getHashFromString'

const base = {
  id: 'https://writing.example/activities/1',
  actor: 'https://writing.example/users/ninetiger'
}

describe('getForwardedJobMessage', () => {
  it.each([
    { description: 'routes a forwarded Create', type: 'Create' },
    { description: 'routes a forwarded Update', type: 'Update' },
    { description: 'routes a forwarded Delete', type: 'Delete' }
  ])('$description', ({ type }) => {
    const activity = {
      ...base,
      type,
      object: 'https://writing.example/statuses/1'
    } as unknown as StatusActivity
    expect(getForwardedJobMessage(activity)).toEqual({
      id: getHashFromString(`${base.id}#forwarded`),
      name: PROCESS_FORWARDED_ACTIVITY_JOB_NAME,
      data: activity
    })
  })

  it.each([
    { description: 'drops a forwarded Announce', type: 'Announce' },
    { description: 'drops a forwarded Undo', type: 'Undo' },
    { description: 'drops a forwarded Like', type: 'Like' }
  ])('$description', ({ type }) => {
    const activity = {
      ...base,
      type,
      object: 'https://writing.example/statuses/1'
    } as unknown as StatusActivity
    expect(getForwardedJobMessage(activity)).toBeNull()
  })

  it('never attaches a verifiedSenderActorId', () => {
    const activity = {
      ...base,
      type: 'Create',
      object: { id: 'x', type: 'Note' }
    } as unknown as StatusActivity
    expect(getForwardedJobMessage(activity)).not.toHaveProperty(
      'verifiedSenderActorId'
    )
  })
})
