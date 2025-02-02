import { Actor } from '../models/actor'

export const MOCK_SECRET_PHASES = 'secret phases'
const MOCK_PUBLIC_KEY = `
-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAn2KRtMWF1GBZEKFta8Kp
Fvy3rwK52sjk0ohkh+X4BN1tL/MTnHxmlgEVGhoQxnFo8Nq7iq79zdDlSQml6YL2
8nJrA70UDt72xds4Y6LweVQ5MP5lYONWdOwfx84jXkL+YcdZlvZqd0X2HrkuIVI8
RyAk8jjvDOqkyeInrsESFyhFHBygEJbGcF9rHcQy8WP31vxC2s6I1xl8cCQS4cMp
Arjdl+raCSgsW5/cjzjf5gyIb3e1q2f4LBlevCvqPOI6xhQTaN4beIeMkSdNRAST
fRiEwCQJGAVH4YoNmcgtI6E9fXI5S29McMoKmAFI568U4VHeyJJS2RA7/XyWrUPE
3o3qG0CV0O+WKgy2zkmy1M7RPqj5gxwDcfzVEm0e1CqUXbgGhb74K5VYUxGgZHlP
f4PF5FVuw4K9GuVGSlKVVqqyQYY38LEfmDuVUpnz4MQTWET3Jhpe4EaljOvBLTT/
QiuCS9gQ0uwcUq0W0JSFILqkSYdBQRTEFZo6hLZkMyWElCxvowzZye7CSuj+qmlX
bwsXXLUv565CjCBgl2F2XLBy7XJsEJghAJIWhNvWExbaiufc696l82prTZa9GvbQ
pS0FKLPKiirqxGR13p0szNc657NsqFYGa7pJTVtE/hhCMzMGNxZ1T8jPwrfIVnzX
o+AgFvHbOoupWz+YO8oa9gsCAwEAAQ==
-----END PUBLIC KEY-----`
const MOCK_PRIVATE_KEY = `
-----BEGIN ENCRYPTED PRIVATE KEY-----
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
-----END ENCRYPTED PRIVATE KEY-----`

interface Params {
  id?: string
  sharedInboxUrl?: string
}
export const MockActor = ({
  id = 'https://chat.llun.dev/users/me',
  sharedInboxUrl = 'https://chat.llun.dev/inbox'
}: Params): Actor =>
  Actor.parse({
    id,
    username: new URL(id).pathname.split('/').pop() ?? 'me',
    domain: 'chat.llun.dev',
    followersUrl: `${id}/followers`,
    inboxUrl: `${id}/inbox`,
    sharedInboxUrl,
    publicKey: MOCK_PUBLIC_KEY,
    privateKey: MOCK_PRIVATE_KEY,

    followingCount: 0,
    followersCount: 0,

    statusCount: 0,

    lastStatusAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
