import { FC, MouseEvent, useState } from 'react'

import { getAppleSharedAlbumAssets, getAppleSharedGallery } from '../../client'
import { Media, getMediaList } from '../../medias/apple/media'
import { Profile } from '../../models/actor'
import { Button } from '../Button'
import { Modal } from '../Modal'

interface Props {
  profile: Profile
}

export const AppleGallerButton: FC<Props> = ({ profile }) => {
  const [showGallery, setShowGallery] = useState<boolean>(false)
  const [medias, setMedias] = useState<Media[]>([])

  if (!profile.appleSharedAlbumToken) return null

  const onOpenGallery = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!profile.appleSharedAlbumToken) return

    const stream = await getAppleSharedGallery({
      albumToken: profile.appleSharedAlbumToken
    })
    // Fail to load Apple Stream
    if (!stream) return

    const mediaList = getMediaList(stream)
    const assets = await getAppleSharedAlbumAssets({
      albumToken: profile.appleSharedAlbumToken,
      photoGuids: mediaList.map((item) => item.guid)
    })

    // Fail to load Apple Assets
    if (!assets) return

    console.log(stream?.photos)

    setShowGallery(true)
  }

  return (
    <>
      <Button variant="link" onClick={onOpenGallery}>
        <i className="bi bi-image" />
      </Button>
      <Modal isOpen={showGallery} onRequestClose={() => setShowGallery(false)}>
        Shows all medias from apple share gallery if available? or open a file
        picker
      </Modal>
    </>
  )
}
