import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'

import { describeAddFailure, describeAddResult } from './galleryAddToAlbumUi'

const outcome = (added: string[], existing: string[], skipped: string[]) => ({
  added,
  existing,
  skipped,
  album: buildAlbumCard('a1')
})

describe('describeAddResult', () => {
  it('says how many photos were added', () => {
    expect(describeAddResult('Kruger', outcome(['1'], [], []))).toBe(
      'Added 1 photo to “Kruger”.'
    )
    expect(describeAddResult('Kruger', outcome(['1', '2'], [], []))).toBe(
      'Added 2 photos to “Kruger”.'
    )
  })

  it('says what was already there and what was skipped', () => {
    expect(
      describeAddResult('Kruger', outcome(['1', '2'], ['3'], ['4', '5']))
    ).toBe(
      'Added 2 photos to “Kruger”. 1 photo was already there. 2 photos couldn’t be added: they aren’t in your gallery any more.'
    )
  })

  it('says so when every photo was already in the album', () => {
    expect(describeAddResult('Kruger', outcome([], ['1'], []))).toBe(
      'That photo was already in “Kruger”.'
    )
    expect(describeAddResult('Kruger', outcome([], ['1', '2'], []))).toBe(
      'All 2 photos were already in “Kruger”.'
    )
  })

  it('says nothing was added when everything was skipped', () => {
    expect(describeAddResult('Kruger', outcome([], [], ['1']))).toBe(
      'Nothing was added to “Kruger”. 1 photo couldn’t be added: it isn’t in your gallery any more.'
    )
  })
})

describe('describeAddFailure', () => {
  it('says the album is full and nothing was added', () => {
    expect(
      describeAddFailure({
        title: 'Kruger',
        message: 'Too many photos in this album',
        isFull: true,
        earlier: null,
        requested: 150
      })
    ).toBe(
      '“Kruger” is full: an album holds at most 2,000 photos. No photos were added.'
    )
  })

  it('reports how far an add got before it stopped', () => {
    expect(
      describeAddFailure({
        title: 'Kruger',
        message: 'Too many photos in this album',
        isFull: true,
        earlier: outcome(
          Array.from({ length: 90 }, (_, i) => String(i)),
          ['x'],
          ['y']
        ),
        requested: 250
      })
    ).toBe(
      '“Kruger” is full: an album holds at most 2,000 photos. Added 90 of 250; the other 158 were not added.'
    )
  })

  it('passes a server message on for any other failure', () => {
    expect(
      describeAddFailure({
        title: 'Kruger',
        message: 'Network down',
        isFull: false,
        earlier: null,
        requested: 3
      })
    ).toBe(
      'Couldn’t finish adding to “Kruger”. Network down Nothing was added.'
    )
  })
})
