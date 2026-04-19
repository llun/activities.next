export type RegionType = 'continent' | 'subregion' | 'country'

export interface RegionBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export interface MapRegion {
  id: string
  name: string
  type: RegionType
  bounds: RegionBounds
}

// All regions are ordered: continents → sub-regions → countries (alphabetical within type)
export const ALL_REGIONS: MapRegion[] = [
  // ── Continents ──────────────────────────────────────────────────────────────
  {
    id: 'africa',
    name: 'Africa',
    type: 'continent',
    bounds: { minLat: -35.0, maxLat: 37.5, minLng: -17.5, maxLng: 51.5 }
  },
  {
    id: 'asia',
    name: 'Asia',
    type: 'continent',
    bounds: { minLat: -10.0, maxLat: 77.7, minLng: 26.0, maxLng: 180.0 }
  },
  {
    id: 'europe',
    name: 'Europe',
    type: 'continent',
    bounds: { minLat: 34.5, maxLat: 71.2, minLng: -25.0, maxLng: 45.0 }
  },
  {
    id: 'north_america',
    name: 'North America',
    type: 'continent',
    bounds: { minLat: 7.2, maxLat: 83.6, minLng: -168.0, maxLng: -52.0 }
  },
  {
    id: 'oceania',
    name: 'Oceania',
    type: 'continent',
    bounds: { minLat: -47.3, maxLat: 0.0, minLng: 110.0, maxLng: 180.0 }
  },
  {
    id: 'south_america',
    name: 'South America',
    type: 'continent',
    bounds: { minLat: -56.0, maxLat: 12.5, minLng: -81.5, maxLng: -34.0 }
  },

  // ── Sub-regions ─────────────────────────────────────────────────────────────
  {
    id: 'caribbean',
    name: 'Caribbean',
    type: 'subregion',
    bounds: { minLat: 10.0, maxLat: 26.5, minLng: -85.0, maxLng: -59.0 }
  },
  {
    id: 'central_africa',
    name: 'Central Africa',
    type: 'subregion',
    bounds: { minLat: -18.0, maxLat: 23.5, minLng: 7.0, maxLng: 36.0 }
  },
  {
    id: 'central_america',
    name: 'Central America',
    type: 'subregion',
    bounds: { minLat: 7.2, maxLat: 18.5, minLng: -92.3, maxLng: -77.2 }
  },
  {
    id: 'central_asia',
    name: 'Central Asia',
    type: 'subregion',
    bounds: { minLat: 35.0, maxLat: 55.5, minLng: 46.0, maxLng: 87.5 }
  },
  {
    id: 'east_africa',
    name: 'East Africa',
    type: 'subregion',
    bounds: { minLat: -11.7, maxLat: 22.0, minLng: 29.5, maxLng: 51.5 }
  },
  {
    id: 'east_asia',
    name: 'East Asia',
    type: 'subregion',
    bounds: { minLat: 18.0, maxLat: 53.5, minLng: 97.0, maxLng: 145.0 }
  },
  {
    id: 'eastern_europe',
    name: 'Eastern Europe',
    type: 'subregion',
    bounds: { minLat: 43.5, maxLat: 60.5, minLng: 14.0, maxLng: 40.5 }
  },
  {
    id: 'melanesia',
    name: 'Melanesia',
    type: 'subregion',
    bounds: { minLat: -22.5, maxLat: 0.0, minLng: 130.0, maxLng: 180.0 }
  },
  {
    id: 'middle_east',
    name: 'Middle East',
    type: 'subregion',
    bounds: { minLat: 12.5, maxLat: 42.0, minLng: 26.0, maxLng: 63.5 }
  },
  {
    id: 'north_africa',
    name: 'North Africa',
    type: 'subregion',
    bounds: { minLat: 15.0, maxLat: 37.5, minLng: -17.5, maxLng: 37.0 }
  },
  {
    id: 'northern_europe',
    name: 'Northern Europe',
    type: 'subregion',
    bounds: { minLat: 54.5, maxLat: 71.2, minLng: -25.0, maxLng: 32.0 }
  },
  {
    id: 'south_asia',
    name: 'South Asia',
    type: 'subregion',
    bounds: { minLat: 5.5, maxLat: 36.5, minLng: 61.0, maxLng: 97.5 }
  },
  {
    id: 'southeast_asia',
    name: 'Southeast Asia',
    type: 'subregion',
    bounds: { minLat: -10.0, maxLat: 28.5, minLng: 92.0, maxLng: 141.0 }
  },
  {
    id: 'southern_africa',
    name: 'Southern Africa',
    type: 'subregion',
    bounds: { minLat: -35.0, maxLat: -15.5, minLng: 11.5, maxLng: 35.5 }
  },
  {
    id: 'west_africa',
    name: 'West Africa',
    type: 'subregion',
    bounds: { minLat: 4.3, maxLat: 23.5, minLng: -17.5, maxLng: 16.0 }
  },
  {
    id: 'western_europe',
    name: 'Western Europe',
    type: 'subregion',
    bounds: { minLat: 36.0, maxLat: 59.5, minLng: -9.5, maxLng: 15.5 }
  },

  // ── Countries ────────────────────────────────────────────────────────────────
  {
    id: 'afghanistan',
    name: 'Afghanistan',
    type: 'country',
    bounds: { minLat: 29.4, maxLat: 38.5, minLng: 60.5, maxLng: 75.0 }
  },
  {
    id: 'albania',
    name: 'Albania',
    type: 'country',
    bounds: { minLat: 39.6, maxLat: 42.7, minLng: 19.3, maxLng: 21.1 }
  },
  {
    id: 'algeria',
    name: 'Algeria',
    type: 'country',
    bounds: { minLat: 18.9, maxLat: 37.1, minLng: -8.7, maxLng: 12.0 }
  },
  {
    id: 'angola',
    name: 'Angola',
    type: 'country',
    bounds: { minLat: -18.0, maxLat: -4.4, minLng: 11.7, maxLng: 24.1 }
  },
  {
    id: 'argentina',
    name: 'Argentina',
    type: 'country',
    bounds: { minLat: -55.1, maxLat: -21.8, minLng: -73.6, maxLng: -53.6 }
  },
  {
    id: 'armenia',
    name: 'Armenia',
    type: 'country',
    bounds: { minLat: 38.8, maxLat: 41.3, minLng: 43.4, maxLng: 46.6 }
  },
  {
    id: 'australia',
    name: 'Australia',
    type: 'country',
    bounds: { minLat: -43.7, maxLat: -10.7, minLng: 113.2, maxLng: 153.6 }
  },
  {
    id: 'austria',
    name: 'Austria',
    type: 'country',
    bounds: { minLat: 46.4, maxLat: 49.0, minLng: 9.5, maxLng: 17.2 }
  },
  {
    id: 'azerbaijan',
    name: 'Azerbaijan',
    type: 'country',
    bounds: { minLat: 38.4, maxLat: 41.9, minLng: 44.8, maxLng: 50.4 }
  },
  {
    id: 'bahrain',
    name: 'Bahrain',
    type: 'country',
    bounds: { minLat: 25.8, maxLat: 26.3, minLng: 50.4, maxLng: 50.7 }
  },
  {
    id: 'bangladesh',
    name: 'Bangladesh',
    type: 'country',
    bounds: { minLat: 20.7, maxLat: 26.6, minLng: 88.0, maxLng: 92.7 }
  },
  {
    id: 'belarus',
    name: 'Belarus',
    type: 'country',
    bounds: { minLat: 51.3, maxLat: 56.2, minLng: 23.2, maxLng: 32.8 }
  },
  {
    id: 'belgium',
    name: 'Belgium',
    type: 'country',
    bounds: { minLat: 49.5, maxLat: 51.5, minLng: 2.5, maxLng: 6.4 }
  },
  {
    id: 'bolivia',
    name: 'Bolivia',
    type: 'country',
    bounds: { minLat: -22.9, maxLat: -9.7, minLng: -69.7, maxLng: -57.5 }
  },
  {
    id: 'bosnia_and_herzegovina',
    name: 'Bosnia and Herzegovina',
    type: 'country',
    bounds: { minLat: 42.6, maxLat: 45.3, minLng: 15.7, maxLng: 19.6 }
  },
  {
    id: 'botswana',
    name: 'Botswana',
    type: 'country',
    bounds: { minLat: -26.9, maxLat: -18.0, minLng: 19.9, maxLng: 29.4 }
  },
  {
    id: 'brazil',
    name: 'Brazil',
    type: 'country',
    bounds: { minLat: -33.8, maxLat: 5.3, minLng: -73.9, maxLng: -34.8 }
  },
  {
    id: 'brunei',
    name: 'Brunei',
    type: 'country',
    bounds: { minLat: 4.0, maxLat: 5.1, minLng: 114.1, maxLng: 115.4 }
  },
  {
    id: 'bulgaria',
    name: 'Bulgaria',
    type: 'country',
    bounds: { minLat: 41.2, maxLat: 44.2, minLng: 22.4, maxLng: 28.6 }
  },
  {
    id: 'cambodia',
    name: 'Cambodia',
    type: 'country',
    bounds: { minLat: 10.4, maxLat: 14.7, minLng: 102.3, maxLng: 107.6 }
  },
  {
    id: 'cameroon',
    name: 'Cameroon',
    type: 'country',
    bounds: { minLat: 1.7, maxLat: 13.1, minLng: 8.5, maxLng: 16.2 }
  },
  {
    id: 'canada',
    name: 'Canada',
    type: 'country',
    bounds: { minLat: 41.7, maxLat: 83.1, minLng: -141.0, maxLng: -52.7 }
  },
  {
    id: 'chile',
    name: 'Chile',
    type: 'country',
    bounds: { minLat: -55.9, maxLat: -17.5, minLng: -75.7, maxLng: -66.4 }
  },
  {
    id: 'china',
    name: 'China',
    type: 'country',
    bounds: { minLat: 18.2, maxLat: 53.6, minLng: 73.5, maxLng: 134.8 }
  },
  {
    id: 'colombia',
    name: 'Colombia',
    type: 'country',
    bounds: { minLat: -4.2, maxLat: 12.5, minLng: -79.0, maxLng: -66.9 }
  },
  {
    id: 'costa_rica',
    name: 'Costa Rica',
    type: 'country',
    bounds: { minLat: 8.0, maxLat: 11.2, minLng: -85.9, maxLng: -82.6 }
  },
  {
    id: 'croatia',
    name: 'Croatia',
    type: 'country',
    bounds: { minLat: 42.4, maxLat: 46.6, minLng: 13.5, maxLng: 19.5 }
  },
  {
    id: 'cuba',
    name: 'Cuba',
    type: 'country',
    bounds: { minLat: 19.8, maxLat: 23.3, minLng: -84.9, maxLng: -74.1 }
  },
  {
    id: 'cyprus',
    name: 'Cyprus',
    type: 'country',
    bounds: { minLat: 34.6, maxLat: 35.7, minLng: 32.3, maxLng: 34.6 }
  },
  {
    id: 'czechia',
    name: 'Czechia',
    type: 'country',
    bounds: { minLat: 48.6, maxLat: 51.1, minLng: 12.1, maxLng: 18.9 }
  },
  {
    id: 'democratic_republic_of_the_congo',
    name: 'Democratic Republic of the Congo',
    type: 'country',
    bounds: { minLat: -13.5, maxLat: 5.4, minLng: 12.2, maxLng: 31.3 }
  },
  {
    id: 'denmark',
    name: 'Denmark',
    type: 'country',
    bounds: { minLat: 54.6, maxLat: 57.8, minLng: 8.1, maxLng: 15.2 }
  },
  {
    id: 'dominican_republic',
    name: 'Dominican Republic',
    type: 'country',
    bounds: { minLat: 17.5, maxLat: 20.0, minLng: -72.0, maxLng: -68.3 }
  },
  {
    id: 'ecuador',
    name: 'Ecuador',
    type: 'country',
    bounds: { minLat: -5.0, maxLat: 1.5, minLng: -80.9, maxLng: -75.2 }
  },
  {
    id: 'egypt',
    name: 'Egypt',
    type: 'country',
    bounds: { minLat: 22.0, maxLat: 31.7, minLng: 24.7, maxLng: 37.0 }
  },
  {
    id: 'el_salvador',
    name: 'El Salvador',
    type: 'country',
    bounds: { minLat: 13.1, maxLat: 14.5, minLng: -90.1, maxLng: -87.7 }
  },
  {
    id: 'ethiopia',
    name: 'Ethiopia',
    type: 'country',
    bounds: { minLat: 3.4, maxLat: 14.9, minLng: 33.0, maxLng: 48.0 }
  },
  {
    id: 'finland',
    name: 'Finland',
    type: 'country',
    bounds: { minLat: 59.8, maxLat: 70.1, minLng: 19.1, maxLng: 31.6 }
  },
  {
    id: 'france',
    name: 'France',
    type: 'country',
    bounds: { minLat: 42.3, maxLat: 51.1, minLng: -4.8, maxLng: 8.2 }
  },
  {
    id: 'georgia',
    name: 'Georgia',
    type: 'country',
    bounds: { minLat: 41.1, maxLat: 43.6, minLng: 40.0, maxLng: 46.7 }
  },
  {
    id: 'germany',
    name: 'Germany',
    type: 'country',
    bounds: { minLat: 47.3, maxLat: 55.1, minLng: 5.9, maxLng: 15.0 }
  },
  {
    id: 'ghana',
    name: 'Ghana',
    type: 'country',
    bounds: { minLat: 4.7, maxLat: 11.2, minLng: -3.3, maxLng: 1.2 }
  },
  {
    id: 'greece',
    name: 'Greece',
    type: 'country',
    bounds: { minLat: 34.8, maxLat: 42.0, minLng: 20.0, maxLng: 28.3 }
  },
  {
    id: 'guatemala',
    name: 'Guatemala',
    type: 'country',
    bounds: { minLat: 13.7, maxLat: 17.8, minLng: -92.2, maxLng: -88.2 }
  },
  {
    id: 'honduras',
    name: 'Honduras',
    type: 'country',
    bounds: { minLat: 13.0, maxLat: 16.5, minLng: -89.4, maxLng: -83.1 }
  },
  {
    id: 'hong_kong',
    name: 'Hong Kong',
    type: 'country',
    bounds: { minLat: 22.1, maxLat: 22.6, minLng: 113.8, maxLng: 114.5 }
  },
  {
    id: 'hungary',
    name: 'Hungary',
    type: 'country',
    bounds: { minLat: 45.7, maxLat: 48.6, minLng: 16.1, maxLng: 22.9 }
  },
  {
    id: 'iceland',
    name: 'Iceland',
    type: 'country',
    bounds: { minLat: 63.4, maxLat: 66.5, minLng: -24.6, maxLng: -13.5 }
  },
  {
    id: 'india',
    name: 'India',
    type: 'country',
    bounds: { minLat: 8.1, maxLat: 35.5, minLng: 68.2, maxLng: 97.4 }
  },
  {
    id: 'indonesia',
    name: 'Indonesia',
    type: 'country',
    bounds: { minLat: -10.0, maxLat: 5.9, minLng: 95.0, maxLng: 141.0 }
  },
  {
    id: 'iran',
    name: 'Iran',
    type: 'country',
    bounds: { minLat: 25.1, maxLat: 39.8, minLng: 44.0, maxLng: 63.3 }
  },
  {
    id: 'iraq',
    name: 'Iraq',
    type: 'country',
    bounds: { minLat: 29.1, maxLat: 37.4, minLng: 38.8, maxLng: 48.6 }
  },
  {
    id: 'ireland',
    name: 'Ireland',
    type: 'country',
    bounds: { minLat: 51.4, maxLat: 55.4, minLng: -10.5, maxLng: -6.0 }
  },
  {
    id: 'israel',
    name: 'Israel',
    type: 'country',
    bounds: { minLat: 29.5, maxLat: 33.3, minLng: 34.3, maxLng: 35.9 }
  },
  {
    id: 'italy',
    name: 'Italy',
    type: 'country',
    bounds: { minLat: 36.6, maxLat: 47.1, minLng: 6.6, maxLng: 18.5 }
  },
  {
    id: 'ivory_coast',
    name: 'Ivory Coast',
    type: 'country',
    bounds: { minLat: 4.3, maxLat: 10.7, minLng: -8.6, maxLng: -2.5 }
  },
  {
    id: 'jamaica',
    name: 'Jamaica',
    type: 'country',
    bounds: { minLat: 17.7, maxLat: 18.5, minLng: -78.4, maxLng: -76.2 }
  },
  {
    id: 'japan',
    name: 'Japan',
    type: 'country',
    bounds: { minLat: 24.0, maxLat: 45.6, minLng: 123.0, maxLng: 145.8 }
  },
  {
    id: 'jordan',
    name: 'Jordan',
    type: 'country',
    bounds: { minLat: 29.2, maxLat: 33.4, minLng: 35.0, maxLng: 39.3 }
  },
  {
    id: 'kazakhstan',
    name: 'Kazakhstan',
    type: 'country',
    bounds: { minLat: 40.6, maxLat: 55.4, minLng: 50.3, maxLng: 87.4 }
  },
  {
    id: 'kenya',
    name: 'Kenya',
    type: 'country',
    bounds: { minLat: -4.7, maxLat: 4.6, minLng: 34.0, maxLng: 41.9 }
  },
  {
    id: 'kuwait',
    name: 'Kuwait',
    type: 'country',
    bounds: { minLat: 28.5, maxLat: 30.1, minLng: 46.6, maxLng: 48.4 }
  },
  {
    id: 'kyrgyzstan',
    name: 'Kyrgyzstan',
    type: 'country',
    bounds: { minLat: 39.2, maxLat: 43.3, minLng: 69.3, maxLng: 80.3 }
  },
  {
    id: 'laos',
    name: 'Laos',
    type: 'country',
    bounds: { minLat: 13.9, maxLat: 22.5, minLng: 100.1, maxLng: 107.6 }
  },
  {
    id: 'latvia',
    name: 'Latvia',
    type: 'country',
    bounds: { minLat: 55.7, maxLat: 57.9, minLng: 21.0, maxLng: 28.2 }
  },
  {
    id: 'lebanon',
    name: 'Lebanon',
    type: 'country',
    bounds: { minLat: 33.1, maxLat: 34.7, minLng: 35.1, maxLng: 36.6 }
  },
  {
    id: 'libya',
    name: 'Libya',
    type: 'country',
    bounds: { minLat: 19.5, maxLat: 33.2, minLng: 9.4, maxLng: 25.2 }
  },
  {
    id: 'lithuania',
    name: 'Lithuania',
    type: 'country',
    bounds: { minLat: 53.9, maxLat: 56.5, minLng: 21.0, maxLng: 26.8 }
  },
  {
    id: 'luxembourg',
    name: 'Luxembourg',
    type: 'country',
    bounds: { minLat: 49.4, maxLat: 50.2, minLng: 5.7, maxLng: 6.5 }
  },
  {
    id: 'malaysia',
    name: 'Malaysia',
    type: 'country',
    bounds: { minLat: 0.9, maxLat: 7.4, minLng: 99.6, maxLng: 119.3 }
  },
  {
    id: 'maldives',
    name: 'Maldives',
    type: 'country',
    bounds: { minLat: -0.7, maxLat: 7.1, minLng: 72.7, maxLng: 73.8 }
  },
  {
    id: 'mali',
    name: 'Mali',
    type: 'country',
    bounds: { minLat: 10.1, maxLat: 25.0, minLng: -4.3, maxLng: 4.3 }
  },
  {
    id: 'mauritius',
    name: 'Mauritius',
    type: 'country',
    bounds: { minLat: -20.5, maxLat: -19.9, minLng: 57.3, maxLng: 57.8 }
  },
  {
    id: 'mexico',
    name: 'Mexico',
    type: 'country',
    bounds: { minLat: 14.5, maxLat: 32.7, minLng: -117.1, maxLng: -86.7 }
  },
  {
    id: 'moldova',
    name: 'Moldova',
    type: 'country',
    bounds: { minLat: 45.5, maxLat: 48.5, minLng: 26.6, maxLng: 30.2 }
  },
  {
    id: 'mongolia',
    name: 'Mongolia',
    type: 'country',
    bounds: { minLat: 41.6, maxLat: 52.2, minLng: 87.8, maxLng: 119.9 }
  },
  {
    id: 'morocco',
    name: 'Morocco',
    type: 'country',
    bounds: { minLat: 27.7, maxLat: 35.9, minLng: -13.2, maxLng: -1.1 }
  },
  {
    id: 'mozambique',
    name: 'Mozambique',
    type: 'country',
    bounds: { minLat: -26.9, maxLat: -10.5, minLng: 30.2, maxLng: 40.8 }
  },
  {
    id: 'myanmar',
    name: 'Myanmar',
    type: 'country',
    bounds: { minLat: 9.8, maxLat: 28.5, minLng: 92.2, maxLng: 101.2 }
  },
  {
    id: 'namibia',
    name: 'Namibia',
    type: 'country',
    bounds: { minLat: -28.9, maxLat: -16.9, minLng: 11.7, maxLng: 25.3 }
  },
  {
    id: 'nepal',
    name: 'Nepal',
    type: 'country',
    bounds: { minLat: 26.4, maxLat: 30.4, minLng: 80.1, maxLng: 88.2 }
  },
  {
    id: 'netherlands',
    name: 'Netherlands',
    type: 'country',
    bounds: { minLat: 50.8, maxLat: 53.6, minLng: 3.4, maxLng: 7.2 }
  },
  {
    id: 'new_zealand',
    name: 'New Zealand',
    type: 'country',
    bounds: { minLat: -47.3, maxLat: -34.4, minLng: 166.3, maxLng: 178.6 }
  },
  {
    id: 'nicaragua',
    name: 'Nicaragua',
    type: 'country',
    bounds: { minLat: 10.7, maxLat: 15.0, minLng: -87.7, maxLng: -83.1 }
  },
  {
    id: 'nigeria',
    name: 'Nigeria',
    type: 'country',
    bounds: { minLat: 4.3, maxLat: 13.9, minLng: 2.7, maxLng: 14.7 }
  },
  {
    id: 'north_korea',
    name: 'North Korea',
    type: 'country',
    bounds: { minLat: 37.7, maxLat: 42.7, minLng: 124.2, maxLng: 130.7 }
  },
  {
    id: 'norway',
    name: 'Norway',
    type: 'country',
    bounds: { minLat: 57.9, maxLat: 71.2, minLng: 4.6, maxLng: 31.2 }
  },
  {
    id: 'oman',
    name: 'Oman',
    type: 'country',
    bounds: { minLat: 16.6, maxLat: 26.4, minLng: 52.0, maxLng: 59.9 }
  },
  {
    id: 'pakistan',
    name: 'Pakistan',
    type: 'country',
    bounds: { minLat: 23.7, maxLat: 37.1, minLng: 60.9, maxLng: 77.8 }
  },
  {
    id: 'panama',
    name: 'Panama',
    type: 'country',
    bounds: { minLat: 7.2, maxLat: 9.7, minLng: -83.1, maxLng: -77.2 }
  },
  {
    id: 'papua_new_guinea',
    name: 'Papua New Guinea',
    type: 'country',
    bounds: { minLat: -11.7, maxLat: -1.3, minLng: 140.9, maxLng: 155.7 }
  },
  {
    id: 'paraguay',
    name: 'Paraguay',
    type: 'country',
    bounds: { minLat: -27.6, maxLat: -19.3, minLng: -62.6, maxLng: -54.3 }
  },
  {
    id: 'peru',
    name: 'Peru',
    type: 'country',
    bounds: { minLat: -18.4, maxLat: 0.0, minLng: -81.3, maxLng: -68.7 }
  },
  {
    id: 'philippines',
    name: 'Philippines',
    type: 'country',
    bounds: { minLat: 4.6, maxLat: 21.1, minLng: 116.9, maxLng: 126.6 }
  },
  {
    id: 'poland',
    name: 'Poland',
    type: 'country',
    bounds: { minLat: 49.0, maxLat: 54.9, minLng: 14.1, maxLng: 24.2 }
  },
  {
    id: 'portugal',
    name: 'Portugal',
    type: 'country',
    bounds: { minLat: 36.8, maxLat: 42.2, minLng: -9.5, maxLng: -6.2 }
  },
  {
    id: 'qatar',
    name: 'Qatar',
    type: 'country',
    bounds: { minLat: 24.6, maxLat: 26.2, minLng: 50.8, maxLng: 51.6 }
  },
  {
    id: 'romania',
    name: 'Romania',
    type: 'country',
    bounds: { minLat: 43.6, maxLat: 48.3, minLng: 22.1, maxLng: 29.7 }
  },
  {
    id: 'russia',
    name: 'Russia',
    type: 'country',
    bounds: { minLat: 41.2, maxLat: 77.7, minLng: 19.6, maxLng: 180.0 }
  },
  {
    id: 'rwanda',
    name: 'Rwanda',
    type: 'country',
    bounds: { minLat: -2.8, maxLat: -1.1, minLng: 29.0, maxLng: 30.9 }
  },
  {
    id: 'saudi_arabia',
    name: 'Saudi Arabia',
    type: 'country',
    bounds: { minLat: 16.4, maxLat: 32.2, minLng: 36.5, maxLng: 55.7 }
  },
  {
    id: 'senegal',
    name: 'Senegal',
    type: 'country',
    bounds: { minLat: 12.3, maxLat: 16.7, minLng: -17.5, maxLng: -11.4 }
  },
  {
    id: 'serbia',
    name: 'Serbia',
    type: 'country',
    bounds: { minLat: 42.2, maxLat: 46.2, minLng: 18.8, maxLng: 22.9 }
  },
  {
    id: 'singapore',
    name: 'Singapore',
    type: 'country',
    bounds: { minLat: 1.1, maxLat: 1.5, minLng: 103.6, maxLng: 104.0 }
  },
  {
    id: 'slovakia',
    name: 'Slovakia',
    type: 'country',
    bounds: { minLat: 47.7, maxLat: 49.6, minLng: 16.8, maxLng: 22.6 }
  },
  {
    id: 'slovenia',
    name: 'Slovenia',
    type: 'country',
    bounds: { minLat: 45.4, maxLat: 46.9, minLng: 13.4, maxLng: 16.6 }
  },
  {
    id: 'somalia',
    name: 'Somalia',
    type: 'country',
    bounds: { minLat: -1.7, maxLat: 12.0, minLng: 40.9, maxLng: 51.4 }
  },
  {
    id: 'south_africa',
    name: 'South Africa',
    type: 'country',
    bounds: { minLat: -34.8, maxLat: -22.1, minLng: 16.5, maxLng: 32.9 }
  },
  {
    id: 'south_korea',
    name: 'South Korea',
    type: 'country',
    bounds: { minLat: 33.1, maxLat: 38.6, minLng: 126.1, maxLng: 129.6 }
  },
  {
    id: 'spain',
    name: 'Spain',
    type: 'country',
    bounds: { minLat: 36.0, maxLat: 43.8, minLng: -9.3, maxLng: 4.3 }
  },
  {
    id: 'sri_lanka',
    name: 'Sri Lanka',
    type: 'country',
    bounds: { minLat: 5.9, maxLat: 9.8, minLng: 79.7, maxLng: 81.9 }
  },
  {
    id: 'sudan',
    name: 'Sudan',
    type: 'country',
    bounds: { minLat: 8.7, maxLat: 22.2, minLng: 21.8, maxLng: 38.6 }
  },
  {
    id: 'sweden',
    name: 'Sweden',
    type: 'country',
    bounds: { minLat: 55.3, maxLat: 69.1, minLng: 11.1, maxLng: 24.2 }
  },
  {
    id: 'switzerland',
    name: 'Switzerland',
    type: 'country',
    bounds: { minLat: 45.8, maxLat: 47.8, minLng: 5.9, maxLng: 10.5 }
  },
  {
    id: 'syria',
    name: 'Syria',
    type: 'country',
    bounds: { minLat: 32.3, maxLat: 37.3, minLng: 35.7, maxLng: 42.4 }
  },
  {
    id: 'taiwan',
    name: 'Taiwan',
    type: 'country',
    bounds: { minLat: 21.9, maxLat: 25.3, minLng: 120.1, maxLng: 122.0 }
  },
  {
    id: 'tajikistan',
    name: 'Tajikistan',
    type: 'country',
    bounds: { minLat: 36.7, maxLat: 41.0, minLng: 67.4, maxLng: 75.2 }
  },
  {
    id: 'tanzania',
    name: 'Tanzania',
    type: 'country',
    bounds: { minLat: -11.7, maxLat: -1.0, minLng: 29.3, maxLng: 40.5 }
  },
  {
    id: 'thailand',
    name: 'Thailand',
    type: 'country',
    bounds: { minLat: 5.6, maxLat: 20.5, minLng: 97.4, maxLng: 105.6 }
  },
  {
    id: 'timor_leste',
    name: 'Timor-Leste',
    type: 'country',
    bounds: { minLat: -9.5, maxLat: -8.1, minLng: 124.0, maxLng: 127.3 }
  },
  {
    id: 'tunisia',
    name: 'Tunisia',
    type: 'country',
    bounds: { minLat: 30.2, maxLat: 37.5, minLng: 7.5, maxLng: 11.6 }
  },
  {
    id: 'turkey',
    name: 'Turkey',
    type: 'country',
    bounds: { minLat: 35.8, maxLat: 42.1, minLng: 26.0, maxLng: 44.8 }
  },
  {
    id: 'turkmenistan',
    name: 'Turkmenistan',
    type: 'country',
    bounds: { minLat: 35.1, maxLat: 42.8, minLng: 52.4, maxLng: 66.7 }
  },
  {
    id: 'uganda',
    name: 'Uganda',
    type: 'country',
    bounds: { minLat: -1.5, maxLat: 4.2, minLng: 29.6, maxLng: 35.0 }
  },
  {
    id: 'ukraine',
    name: 'Ukraine',
    type: 'country',
    bounds: { minLat: 44.4, maxLat: 52.4, minLng: 22.1, maxLng: 40.2 }
  },
  {
    id: 'united_arab_emirates',
    name: 'United Arab Emirates',
    type: 'country',
    bounds: { minLat: 22.6, maxLat: 26.1, minLng: 51.6, maxLng: 56.4 }
  },
  {
    id: 'united_kingdom',
    name: 'United Kingdom',
    type: 'country',
    bounds: { minLat: 49.9, maxLat: 58.7, minLng: -8.2, maxLng: 1.8 }
  },
  {
    id: 'united_states',
    name: 'United States',
    type: 'country',
    bounds: { minLat: 24.5, maxLat: 49.4, minLng: -124.8, maxLng: -66.9 }
  },
  {
    id: 'uruguay',
    name: 'Uruguay',
    type: 'country',
    bounds: { minLat: -34.9, maxLat: -30.1, minLng: -58.4, maxLng: -53.1 }
  },
  {
    id: 'uzbekistan',
    name: 'Uzbekistan',
    type: 'country',
    bounds: { minLat: 37.2, maxLat: 45.6, minLng: 56.0, maxLng: 73.1 }
  },
  {
    id: 'venezuela',
    name: 'Venezuela',
    type: 'country',
    bounds: { minLat: 0.7, maxLat: 12.2, minLng: -73.4, maxLng: -59.8 }
  },
  {
    id: 'vietnam',
    name: 'Vietnam',
    type: 'country',
    bounds: { minLat: 8.6, maxLat: 23.4, minLng: 102.1, maxLng: 109.5 }
  },
  {
    id: 'yemen',
    name: 'Yemen',
    type: 'country',
    bounds: { minLat: 12.6, maxLat: 19.0, minLng: 42.5, maxLng: 54.5 }
  },
  {
    id: 'zambia',
    name: 'Zambia',
    type: 'country',
    bounds: { minLat: -18.1, maxLat: -8.2, minLng: 22.0, maxLng: 33.7 }
  },
  {
    id: 'zimbabwe',
    name: 'Zimbabwe',
    type: 'country',
    bounds: { minLat: -22.4, maxLat: -15.6, minLng: 25.2, maxLng: 33.1 }
  }
]

/** Lookup map from region ID to region data. */
export const REGION_MAP = new Map<string, MapRegion>(
  ALL_REGIONS.map((r) => [r.id, r])
)

/**
 * Serialize an array of region IDs to a canonical string suitable for storage.
 * IDs are lowercased, trimmed, empty entries are dropped, deduplicated, and sorted.
 * Returns an empty string when no valid IDs remain (treated as world-wide).
 */
export const serializeRegions = (regionIds: string[]): string =>
  [
    ...new Set(
      regionIds.map((id) => id.trim().toLowerCase()).filter((id) => id !== '')
    )
  ]
    .sort()
    .join(',')

/**
 * Deserialize a stored region string back into an array of valid region IDs.
 * Unknown IDs are silently dropped. Empty string or blank input returns [].
 */
export const deserializeRegions = (serialized: string): string[] => {
  if (!serialized || serialized.trim() === '') return []
  return serialized
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id !== '' && REGION_MAP.has(id))
}

/**
 * Given a list of region IDs, return the bounding box for each valid region.
 * Unknown IDs are silently dropped.
 * Returns an empty array when no valid regions are provided.
 *
 * Returns individual per-region bounds rather than a single merged envelope,
 * so callers can apply OR filtering correctly (selecting Netherlands + Singapore
 * does not include the sea between them).
 */
export const getRegionBounds = (regionIds: string[]): RegionBounds[] =>
  regionIds
    .map((id) => REGION_MAP.get(id))
    .filter((r): r is MapRegion => r !== undefined)
    .map((r) => r.bounds)
