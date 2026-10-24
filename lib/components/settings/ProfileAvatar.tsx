import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { cn } from '@/lib/utils'

interface Props {
  username: string
  iconUrl: string | null
  className?: string
}

/** The profile's photo, or its initial on the skeleton grey (as in the sidebar's account row). */
export const ProfileAvatar = ({ username, iconUrl, className }: Props) => (
  <Avatar className={cn('shrink-0', className)}>
    {iconUrl && <AvatarImage src={iconUrl} alt="" />}
    <AvatarFallback className="bg-(--skeleton) font-semibold text-muted-foreground dark:bg-input">
      {username.charAt(0).toUpperCase()}
    </AvatarFallback>
  </Avatar>
)
