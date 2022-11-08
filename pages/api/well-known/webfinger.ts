// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";

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
  const host = "8b32-31-161-149-130.eu.ngrok.io";
  const { resource } = req.query;
  const account = resource?.slice("acct:".length, resource.indexOf("@"));

  res.status(200).json({
    subject: `acct:${account}@${host}`,
    aliases: [`https://${host}/@${account}`, `https://${host}/users/llun`],
    links: [
      {
        rel: "http://webfinger.net/rel/profile-page",
        type: "text/html",
        href: `https://${host}/@${account}`,
      },
      {
        rel: "self",
        type: "application/activity+json",
        href: `https://${host}/users/${account}`,
      },
      {
        rel: "http://ostatus.org/schema/1.0/subscribe",
        template: `https://${host}/authorize_interaction?uri={uri}`,
      },
    ],
  });
}
