import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import { urlToId } from '@/lib/utils/urlToId'

import {
  applySavedToItem,
  getGalleryPostHref,
  toMediaDetailsDialogItem,
  toPostEditItem
} from './galleryItemEdit'

const OWNER = 'https://activities.local/users/llun'
const PUBLIC_ID = '0199a1b2-c3d4-7e5f-8a9b-0123456789ab'

const details: MediaDetailsEntity = {
  subject: {
    name: 'Grey Heron',
    scientificName: 'Ardea cinerea',
    category: 'bird',
    taxonKey: '2480',
    taxonPath: ['Animalia', 'Chordata'],
    iucnCategory: null,
    threatStatus: 'not-threatened',
    lookupStatus: 'resolved',
    lookupAt: null,
    lookupStale: false
  },
  takenAt: '2025-04-02T06:00:00.000Z',
  camera: { id: 'cam-1', name: 'Z9' },
  lens: { id: 'lens-1', name: '400mm' },
  exposure: {
    focalLengthMm: 400,
    aperture: 5.6,
    exposureTime: '1/1000',
    iso: 800
  },
  place: {
    name: 'Marsh',
    latitude: 1.5,
    longitude: 2.5,
    precision: 'area',
    countryCode: 'TH',
    nameSource: 'geocoder',
    lookupStatus: 'resolved',
    lookupAt: null,
    lookupStale: false
  },
  inGallery: false,
  subjectSuggestions: null
}

describe('getGalleryPostHref', () => {
  it('links a public status id under the owner profile', () => {
    expect(getGalleryPostHref(OWNER, PUBLIC_ID)).toBe(
      `/@llun@activities.local/${PUBLIC_ID}`
    )
  })

  it('encodes a legacy client id back into the status url', () => {
    const statusUrl = `${OWNER}/statuses/abc`
    expect(getGalleryPostHref(OWNER, urlToId(statusUrl))).toBe(
      `/@llun@activities.local/${encodeURIComponent(statusUrl)}`
    )
  })

  it('has no link for an actor id that is not a local profile url', () => {
    expect(getGalleryPostHref('not a url', PUBLIC_ID)).toBeNull()
    expect(
      getGalleryPostHref('https://activities.local/actors/llun', PUBLIC_ID)
    ).toBeNull()
  })
})

describe('toMediaDetailsDialogItem', () => {
  it('maps the tile to a posted dialog item with its post', () => {
    const item = buildGalleryItem('m1', {
      statusId: PUBLIC_ID,
      attachment: {
        ...buildGalleryItem('m1').attachment,
        name: 'A heron'
      }
    })
    expect(toMediaDetailsDialogItem(item, details, OWNER)).toEqual({
      id: 'm1',
      mediaType: 'image/jpeg',
      url: 'https://activities.local/media/m1.jpg',
      posterUrl: 'https://activities.local/media/m1-thumb.jpg',
      width: 0,
      height: 0,
      description: 'A heron',
      decorative: false,
      details,
      post: {
        statusId: PUBLIC_ID,
        href: `/@llun@activities.local/${PUBLIC_ID}`
      }
    })
  })
})

describe('toMediaDetailsDialogItem for a photo added in Gallery', () => {
  it('has no post and is marked unposted', () => {
    const item = buildGalleryItem('7', { statusId: null, posted: false })

    const mapped = toMediaDetailsDialogItem(item, null, OWNER)

    expect(mapped.post).toBeUndefined()
    expect(mapped.unposted).toBe(true)
    expect(mapped.id).toBe('7')
  })

  it('does not mark a posted photo unposted', () => {
    const mapped = toMediaDetailsDialogItem(
      buildGalleryItem('7', { posted: true }),
      null,
      OWNER
    )
    expect(mapped.unposted).toBeUndefined()
    expect(mapped.post).toBeDefined()
  })
})

describe('applySavedToItem', () => {
  const item = buildGalleryItem('m1', { inGallery: true })

  it('updates only the alt text when the save returned no details', () => {
    const next = applySavedToItem(item, {
      id: 'm1',
      description: 'New alt',
      decorative: false
    })
    expect(next.attachment.name).toBe('New alt')
    expect(next.subject).toBeNull()
    expect(next.inGallery).toBe(true)
  })

  it('carries every detail the tile shows from fresh details', () => {
    const next = applySavedToItem(item, {
      id: 'm1',
      description: 'New alt',
      decorative: false,
      details
    })
    expect(next.subject).toEqual({
      name: 'Grey Heron',
      scientificName: 'Ardea cinerea',
      category: 'bird',
      taxonKey: '2480',
      taxonPath: ['Animalia', 'Chordata']
    })
    expect(next.takenAt).toBe('2025-04-02T06:00:00.000Z')
    expect(next.camera).toEqual({ id: 'cam-1', name: 'Z9' })
    expect(next.lens).toEqual({ id: 'lens-1', name: '400mm' })
    expect(next.exposure).toEqual(details.exposure)
    expect(next.inGallery).toBe(false)
    expect(next.place).toEqual({
      name: 'Marsh',
      precision: 'area',
      latitude: 1.5,
      longitude: 2.5,
      countryCode: 'TH'
    })
  })

  it('clears details the save removed', () => {
    const next = applySavedToItem(
      buildGalleryItem('m1', { subject: details.subject as never }),
      {
        id: 'm1',
        description: '',
        decorative: false,
        details: {
          ...details,
          subject: null,
          camera: null,
          lens: null,
          place: null
        }
      }
    )
    expect(next.subject).toBeNull()
    expect(next.camera).toBeNull()
    expect(next.lens).toBeNull()
    expect(next.place).toBeNull()
  })
})

describe('toPostEditItem', () => {
  const attachment = buildGalleryItem('m1').attachment

  it('builds the editor item from a post attachment, with the client status id', () => {
    const item = toPostEditItem(attachment)

    expect(item).toEqual(
      expect.objectContaining({
        mediaId: 'm1',
        statusId: urlToId(attachment.statusId),
        attachment,
        subject: null
      })
    )
  })

  it('has none for a file without a media id', () => {
    expect(toPostEditItem({ ...attachment, mediaId: null })).toBeNull()
    expect(toPostEditItem({ ...attachment, mediaId: undefined })).toBeNull()
  })
})
