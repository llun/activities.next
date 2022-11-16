import type { NextApiRequest, NextApiResponse } from 'next'
import { parse } from '../../../../lib/signature'

type Data =
  | {
      name: string
    }
  | {
      error: string
    }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const headerSignature = req.headers.signature
  if (!headerSignature) {
    return res.status(400).send({ error: 'Bad Request' })
  }

  const signatureParts = await parse(headerSignature as string)
  if (!signatureParts.keyId) {
    return res.status(400).send({ error: 'Bad Request' })
  }

  console.log('following', req.query, req.headers)
  res.status(200).json({ name: 'John Doe' })
}
