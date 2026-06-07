import { redirect } from 'next/navigation'

import { CustomEmojiManager } from '@/lib/components/admin/CustomEmojiManager'
import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { toAdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const emojis = await database.getCustomEmojis({ includeDisabled: true })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custom emojis"
        description="Upload instance custom emoji. People type :shortcode: in a post to use them, and they federate to other servers."
      />
      <CustomEmojiManager initialEmojis={emojis.map(toAdminCustomEmoji)} />
    </div>
  )
}

export default Page
