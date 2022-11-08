// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";
import { HOST } from "../../../lib/config";

type Link =
  | { rel: string; type: string; href: string }
  | { rel: string; template: string };

type Data = {
  subject: string;
  aliases: string[];
  links: Link[];
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const { resource } = req.query;
  const account = resource?.slice("acct:".length, resource.indexOf("@"));

  res.status(200).json({
    subject: `acct:${account}@${HOST}`,
    aliases: [`https://${HOST}/@${account}`, `https://${HOST}/users/llun`],
    links: [
      {
        rel: "http://webfinger.net/rel/profile-page",
        type: "text/html",
        href: `https://${HOST}/@${account}`,
      },
      {
        rel: "self",
        type: "application/activity+json",
        href: `https://${HOST}/users/${account}`,
      },
      {
        rel: "http://ostatus.org/schema/1.0/subscribe",
        template: `https://${HOST}/authorize_interaction?uri={uri}`,
      },
    ],
  });
}
