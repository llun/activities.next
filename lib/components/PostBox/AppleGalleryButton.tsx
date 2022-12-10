import { FC, useState } from 'react'

import { getAppleSharedGallery } from '../../client'
import { Profile } from '../../models/actor'
import { Button } from '../Button'
import { Modal } from '../Modal'

interface Props {
  profile: Profile
}

export const AppleGallerButton: FC<Props> = ({ profile }) => {
  const [showGallery, setShowGallery] = useState<boolean>(false)

  if (!profile.appleSharedAlbumToken) return null

  const onOpenGallery = async () => {
    console.log(profile.appleSharedAlbumToken)
    if (!profile.appleSharedAlbumToken) return

    console.log('fetching gallery')
    const gallery = await getAppleSharedGallery({
      albumToken: profile.appleSharedAlbumToken
    })
    console.log(gallery)

    setShowGallery(true)
  }

  return (
    <Button variant="link" onClick={onOpenGallery}>
      <i className="bi bi-image"></i>
      <Modal isOpen={showGallery} onRequestClose={() => setShowGallery(false)}>
        Shows all medias from apple share gallery if available? or open a file
        picker
      </Modal>
    </Button>
  )
}
