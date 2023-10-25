import { DEFAULT_202, ERROR_404, ERROR_500 } from '../../../../lib/errors'
import { SharedKeyApiGuard, headerHost } from '../../../../lib/guard'
import { getStorage } from '../../../../lib/storage'

const handler = SharedKeyApiGuard(async (req, res) => {
  const { username } = req.query
  const storage = await getStorage()
  if (!storage) {
    res.status(500).json(ERROR_500)
    return
  }

  const host = headerHost(req.headers)
  const actor = await storage.getActorFromUsername({
    username: username as string,
    domain: host as string
  })
  if (!actor) {
    res.status(404).json(ERROR_404)
    return
  }

  await Promise.all([
    res.revalidate(`/${actor.getMention()}`),
    res.revalidate(`/${actor.getMention(true)}`)
  ])
  res.status(202).json(DEFAULT_202)
})

export default handler
