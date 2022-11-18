import type { NextApiRequest, NextApiResponse } from 'next'
import util from 'util'
import { acceptFollow } from '../../../../lib/activities'
import {
  AcceptFollow,
  FollowRequest,
  UndoFollow
} from '../../../../lib/activities/types'
import { getConfig } from '../../../../lib/config'
import { ERROR_400, ERROR_404 } from '../../../../lib/errors'
import { apiGuard } from '../../../../lib/guard'

import { parse } from '../../../../lib/signature'
import { getStorage } from '../../../../lib/storage'

type Data =
  | {
      name: string
    }
  | {
      error: string
    }

function follow() {
  // target_account = account_from_uri(object_uri)
  // return if target_account.nil? || !target_account.local? || delete_arrived_first?(@json['id'])
  // # Update id of already-existing follow requests
  // existing_follow_request = ::FollowRequest.find_by(account: @account, target_account: target_account)
  // unless existing_follow_request.nil?
  //   existing_follow_request.update!(uri: @json['id'])
  //   return
  // end
  // if target_account.blocking?(@account) || target_account.domain_blocking?(@account.domain) || target_account.moved? || target_account.instance_actor?
  //   reject_follow_request!(target_account)
  //   return
  // end
  // # Fast-forward repeat follow requests
  // existing_follow = ::Follow.find_by(account: @account, target_account: target_account)
  // unless existing_follow.nil?
  //   existing_follow.update!(uri: @json['id'])
  //   AuthorizeFollowService.new.call(@account, target_account, skip_follow_request: true, follow_request_uri: @json['id'])
  //   return
  // end
  // follow_request = FollowRequest.create!(account: @account, target_account: target_account, uri: @json['id'])
  // if target_account.locked? || @account.silenced?
  //   LocalNotificationWorker.perform_async(target_account.id, follow_request.id, 'FollowRequest', 'follow_request')
  // else
  //   AuthorizeFollowService.new.call(@account, target_account)
  //   LocalNotificationWorker.perform_async(target_account.id, ::Follow.find_by(account: @account, target_account: target_account).id, 'Follow', 'follow')
  // end
  // https://github.com/mastodon/mastodon/blob/main/app/lib/activitypub/activity/follow.rb#L3
  // def reject_follow_request!(target_account)
  //   json = Oj.dump(serialize_payload(FollowRequest.new(account: @account, target_account: target_account, uri: @json['id']), ActivityPub::RejectFollowSerializer))
  //   ActivityPub::DeliveryWorker.perform_async(json, target_account.id, @account.inbox_url)
  // end
}

/**
   * user inbox { account: 'me' } {
  host: 'chat.llun.in.th',
  'user-agent': 'http.rb/5.1.0 (Mastodon/4.0.1; +https://glasgow.social/)',
  'content-length': '358',
  'accept-encoding': 'gzip',
  'cdn-loop': 'cloudflare',
  'cf-connecting-ip': '35.176.29.0',
  'cf-ipcountry': 'GB',
  'cf-ray': '76aea7538da8769b-LHR',
  'cf-visitor': '{"scheme":"https"}',
  'cf-warp-tag-id': '2438ab28-f04b-4dfc-8169-ee5c28319095',
  connection: 'keep-alive',
  'content-type': 'application/activity+json',
  date: 'Wed, 16 Nov 2022 07:53:33 GMT',
  digest: 'SHA-256=AVI4RrJyuPLMhpOPHBh4uNVOn0BpMtc+VG07FxBuow0=',
  signature: 'keyId="https://glasgow.social/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="OKzOH/KFIF5gTdcUuUhn1hcKNsRTUD95xXvvu/YhiMwtfpNz2OOdRWd6nYJHRBFN721pZMBwyqjj1VdS5SOOO64g04FQXPXgPUqKBQF6ZNkoS4Xgj3yPA+BIvyWTN7U9la16Mej2ICVyl5+JtDYH6uMe0EU2MuTBjf843wxPLp30/RWHrMroOjUNuMitanw1gexjSiAHvFNLJvpEg0EW3sn/uA/IaINC1pvBI64S8ky1662GDTrsVXaiqugvUhkZN39cC+B5sSguscoyMB3QKtkw0mDit1gWxk4vZrvGXQn6OSXa6HiMJ0DevuLpe9t2tqJEBUgFGVExt1j0qFn0gg=="',
  'x-forwarded-for': '35.176.29.0',
  'x-forwarded-proto': 'https'
}
'{"@context":"https://www.w3.org/ns/activitystreams","id":"https://glasgow.social/users/llun#accepts/follows/53870","type":"Accept","actor":"https://glasgow.social/users/llun","object":{"id":"https://chat.llun.in.th/af9ca279-aad7-4d7c-bdc2-d12dba728e15","type":"Follow","actor":"https://chat.llun.in.th/users/me","object":"https://glasgow.social/users/llun"}}'


   */

/**
   * follow
   * user inbox { account: 'fix' } {
  host: 'chat.llun.in.th',
  'user-agent': 'http.rb/5.1.0 (Mastodon/4.0.0rc3; +https://glasgow.social/)',
  'content-length': '224',
  'accept-encoding': 'gzip',
  'cdn-loop': 'cloudflare',
  'cf-connecting-ip': '35.176.29.0',
  'cf-ipcountry': 'GB',
  'cf-ray': '76899e89bfc176fb-LHR',
  'cf-visitor': '{"scheme":"https"}',
  'cf-warp-tag-id': '172a936e-42c2-409e-b2e4-fa661df51c65',
  connection: 'keep-alive',
  'content-type': 'application/activity+json',
  date: 'Fri, 11 Nov 2022 20:01:20 GMT',
  digest: 'SHA-256=tLFKlnhmf3jVIJ1O9RRn4Sq7I8OMwMmi78SfFuHlIX4=',
  signature: 'keyId="https://glasgow.social/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="fn0UE4OjvTx/TP7DebtsPHDlfDJ0SHomdyCf7tbzRQM0VebMlCx0rjNjEMxpFz3+jghLvm03+7EDtPSyv8cabNwV5DnNIELCbT58bMcCM1amVNdnm6SC7EoXI4zuYuDabYVTFw0BwGOlE1pPvvY6zsqMzWszdeZwzxkrKFVkEfqSBmWNFI94VK9zb690Tt99+npVvUIFy59pj/HaRHpK4wfFL22Bb1C50t5UzGdY3ZhEHom+ZdSco18NWdJ0aguSfQrVBMuSGKXyixOPCQXJQjmKJ8j0eEi5k2jsdh2oABOwlDzLlQksUZJZ7wzHdFhnSDxDh0rXGxgHvkso5hkfFA=="',
  'x-forwarded-for': '35.176.29.0',
  'x-forwarded-proto': 'https'
}
'{"@context":"https://www.w3.org/ns/activitystreams","id":"https://glasgow.social/3ba6b825-1f36-4d2e-b875-e54c54c757b0","type":"Follow","actor":"https://glasgow.social/users/llun","object":"https://chat.llun.in.th/users/fix"}'

   */

/**
   * unfollow
 * user inbox { account: 'fix' } {
  host: 'chat.llun.in.th',
  'user-agent': 'http.rb/5.1.0 (Mastodon/4.0.0rc3; +https://glasgow.social/)',
  'content-length': '353',
  'accept-encoding': 'gzip',
  'cdn-loop': 'cloudflare',
  'cf-connecting-ip': '35.176.29.0',
  'cf-ipcountry': 'GB',
  'cf-ray': '76899ea98b6776fb-LHR',
  'cf-visitor': '{"scheme":"https"}',
  'cf-warp-tag-id': '172a936e-42c2-409e-b2e4-fa661df51c65',
  connection: 'keep-alive',
  'content-type': 'application/activity+json',
  date: 'Fri, 11 Nov 2022 20:01:26 GMT',
  digest: 'SHA-256=Gsnurfp23PVKrHM2C2e9PFGoBTS3BpCwrYUYGVlu+Nk=',
  signature: 'keyId="https://glasgow.social/users/llun#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="wgBKZG9FDAgxWog5fx2xFgqhSHo7uAy1IUNfxy6Dzi49wjAfnlUTDYbAYVtRNBsDyMrJJ1LPihLJYeppOdIt1KCZfPuLDaowlzC+a0ceQHE7w5sI15Xhh3/yO/KrJ2jT1QAuoUsh5BR9J9J/BI0VjrDae1pqbd+HL4LCa6t5lUptRRjK0m3q0Nv0UNjSHlDU/STPPlaFZ7DGDyitrKnvadc7EXCB+Hr5ZSnCJ/9+Xp3HqN2KrkzIOhA2tsgzoZXsNwR5GTawIYZkxlW4/a6p5rGbJLIOB5eIK6rh4qiW+3LMQxhQM5U0iwz9Gmcpc5bz8Awhh9qkNs8dvCRFOSkeLQ=="',
  'x-forwarded-for': '35.176.29.0',
  'x-forwarded-proto': 'https'
}
'{"@context":"https://www.w3.org/ns/activitystreams","id":"https://glasgow.social/users/llun#follows/41502/undo","type":"Undo","actor":"https://glasgow.social/users/llun","object":{"id":"https://glasgow.social/3ba6b825-1f36-4d2e-b875-e54c54c757b0","type":"Follow","actor":"https://glasgow.social/users/llun","object":"https://chat.llun.in.th/users/fix"}}'

 */

export default apiGuard(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === 'POST') {
      const activity = JSON.parse(req.body)
      const storage = await getStorage()
      if (!storage) {
        return res.status(400).json(ERROR_400)
      }

      switch (activity.type) {
        case 'Accept': {
          const acceptFollow = activity as AcceptFollow
          const followId = acceptFollow.object.id.substring(
            `https://${getConfig().host}/`.length
          )
          const follow = await storage.getFollowFromId(followId)
          if (!follow) {
            return res.status(404).json(ERROR_404)
          }
          await storage.updateFollowStatus(followId, 'Accepted')
          return res.status(202).send('')
        }
        case 'Reject': {
          const rejectFollow = activity as AcceptFollow
          const followId = rejectFollow.object.id.substring(
            `https://${getConfig().host}/`.length
          )
          const follow = await storage.getFollowFromId(followId)
          if (!follow) {
            return res.status(404).json(ERROR_404)
          }
          await storage.updateFollowStatus(followId, 'Rejected')
          return res.status(202).send('')
        }
        case 'Follow': {
          const followRequest = activity as FollowRequest
          const actor = await storage.getActorFromId(followRequest.object)
          if (!actor) {
            console.log('No actor found')
            return res.status(404).json(ERROR_404)
          }

          await Promise.all([
            await storage.createFollow(
              followRequest.actor,
              followRequest.object
            ),
            await acceptFollow(actor, followRequest)
          ])
          return res.status(202).send({ target: followRequest.object })
        }
        case 'Undo': {
          const undoRequest = activity as UndoFollow
          const followId = undoRequest.object.id.substring(
            `https://${getConfig().host}/`.length
          )
          const follow = await storage.getFollowFromId(followId)
          if (!follow) {
            return res.status(404).json(ERROR_404)
          }
          await storage.updateFollowStatus(followId, 'Undo')
          return res.status(202).send({ target: undoRequest.object.object })
        }
        default:
          return res.status(202).send('')
      }
    }

    return res.status(404).json(ERROR_404)
  },
  ['POST']
)
