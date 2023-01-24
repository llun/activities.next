import { FC, MouseEvent, useState } from 'react'

import { getAppleSharedAlbumAssets, getAppleSharedGallery } from '../../client'
import { Media, getMediaList, mergeMediaAssets } from '../../medias/apple/media'
import { VideoPosterDerivative } from '../../medias/apple/webstream'
import { ActorProfile } from '../../models/actor'
import { Button } from '../Button'
import { Modal } from '../Modal'
import styles from './AppleGalleryButton.module.scss'

type MediaLoadingState = 'idle' | 'loading' | 'loaded'

interface Props {
  profile: ActorProfile
  onSelectMedia: (media: Media) => void
}

export const AppleGallerButton: FC<Props> = ({ profile, onSelectMedia }) => {
  const [showGallery, setShowGallery] = useState<boolean>(false)
  const [loadingState, setMediaLoadingState] =
    useState<MediaLoadingState>('idle')
  const [medias, setMedias] = useState<Media[]>([])

  if (!profile.appleSharedAlbumToken) return null

  const onOpenGallery = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!profile.appleSharedAlbumToken) return

    if (['idle', 'loaded'].includes(loadingState)) {
      setMediaLoadingState('loading')
      const stream = await getAppleSharedGallery({
        albumToken: profile.appleSharedAlbumToken
      })
      // Fail to load Apple Stream
      if (!stream) return

      const medias = getMediaList(stream)
      const assets = await getAppleSharedAlbumAssets({
        albumToken: profile.appleSharedAlbumToken,
        photoGuids: medias.map((item) => item.guid)
      })

      // Fail to load Apple Assets
      if (!assets) return

      mergeMediaAssets(medias, assets)
      setMedias(medias)
      setMediaLoadingState('loaded')
    }

    setShowGallery(true)
  }

  return (
    <>
      <Button variant="link" onClick={onOpenGallery}>
        <i className="bi bi-image" />
      </Button>
      <Modal isOpen={showGallery} onRequestClose={() => setShowGallery(false)}>
        <div className={styles.box}>
          <div className={styles.gallery}>
            {medias.map((media) => {
              const key =
                media.type === 'video'
                  ? VideoPosterDerivative
                  : Object.keys(media.derivatives)[0]
              const backgroundImage =
                media.derivatives[key].url &&
                `url(${media.derivatives[key].url})`

              return (
                <div
                  key={media.guid}
                  className={styles.media}
                  style={{ backgroundImage }}
                  onClick={() => {
                    setShowGallery(false)
                    onSelectMedia(media)
                  }}
                />
              )
            })}
          </div>
        </div>
      </Modal>
    </>
  )
}
