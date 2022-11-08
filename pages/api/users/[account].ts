// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";
import { HOST } from "../../../lib/config";

type Data = {
  name: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const { account } = req.query;
  const user = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      {
        manuallyApprovesFollowers: "as:manuallyApprovesFollowers",
        toot: "http://joinmastodon.org/ns#",
        featured: {
          "@id": "toot:featured",
          "@type": "@id",
        },
        featuredTags: {
          "@id": "toot:featuredTags",
          "@type": "@id",
        },
        alsoKnownAs: {
          "@id": "as:alsoKnownAs",
          "@type": "@id",
        },
        movedTo: {
          "@id": "as:movedTo",
          "@type": "@id",
        },
        schema: "http://schema.org#",
        PropertyValue: "schema:PropertyValue",
        value: "schema:value",
        discoverable: "toot:discoverable",
        Device: "toot:Device",
        Ed25519Signature: "toot:Ed25519Signature",
        Ed25519Key: "toot:Ed25519Key",
        Curve25519Key: "toot:Curve25519Key",
        EncryptedMessage: "toot:EncryptedMessage",
        publicKeyBase64: "toot:publicKeyBase64",
        deviceId: "toot:deviceId",
        claim: {
          "@type": "@id",
          "@id": "toot:claim",
        },
        fingerprintKey: {
          "@type": "@id",
          "@id": "toot:fingerprintKey",
        },
        identityKey: {
          "@type": "@id",
          "@id": "toot:identityKey",
        },
        devices: {
          "@type": "@id",
          "@id": "toot:devices",
        },
        messageFranking: "toot:messageFranking",
        messageType: "toot:messageType",
        cipherText: "toot:cipherText",
        suspended: "toot:suspended",
      },
    ],
    id: `https://${HOST}/users/${account}`,
    type: "Person",
    following: `https://${HOST}/users/${account}/following`,
    followers: `https://${HOST}/users/${account}/followers`,
    inbox: `https://${HOST}/users/${account}/inbox`,
    outbox: `https://${HOST}/users/${account}/outbox`,
    featured: `https://${HOST}/users/${account}/collections/featured`,
    featuredTags: `https://${HOST}/users/${account}/collections/tags`,
    preferredUsername: `${account}`,
    name: "",
    summary: "",
    url: `https://${HOST}/@${account}`,
    manuallyApprovesFollowers: false,
    discoverable: false,
    published: "2022-11-08T00:00:00Z",
    devices: `https://${HOST}/users/${account}/collections/devices`,
    publicKey: {
      id: `https://${HOST}/users/${account}#main-key`,
      owner: `https://${HOST}/users/${account}`,
      publicKeyPem: "",
    },
    tag: [],
    attachment: [],
    endpoints: {
      sharedInbox: `https://${HOST}/inbox`,
    },
  };
  res.status(200).json(user);
}
