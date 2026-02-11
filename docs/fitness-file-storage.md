# Fitness File Storage Implementation

This document describes the fitness file storage feature that has been implemented in activities.next.

## Overview

The fitness file storage feature allows users to upload fitness activity files (.fit, .gpx, .tcx) and store them similar to how media files are stored. These files share the same quota as media storage and are tracked per account.

## What Has Been Implemented

### 1. Core Storage Infrastructure

#### Configuration (`lib/config/fitnessStorage.ts`)
- `FitnessStorageConfig` - Configuration schema for fitness storage
- Support for both local file storage and S3/Object storage
- Falls back to media storage configuration if fitness-specific config is not provided
- Uses separate path for local storage (`uploads/fitness` by default)
- Uses different prefix for S3 storage (`fitness/` by default)

Environment variables:
- `ACTIVITIES_FITNESS_STORAGE_TYPE` - Storage type (fs, object, s3)
- `ACTIVITIES_FITNESS_STORAGE_PATH` - Local file system path
- `ACTIVITIES_FITNESS_STORAGE_BUCKET` - S3 bucket name
- `ACTIVITIES_FITNESS_STORAGE_REGION` - S3 region
- `ACTIVITIES_FITNESS_STORAGE_HOSTNAME` - Optional S3 hostname
- `ACTIVITIES_FITNESS_STORAGE_PREFIX` - S3 key prefix
- `ACTIVITIES_FITNESS_STORAGE_MAX_FILE_SIZE` - Max file size (default: 50MB)
- `ACTIVITIES_FITNESS_STORAGE_QUOTA_PER_ACCOUNT` - Per-account quota

#### Storage Implementations
- `LocalFileFitnessStorage` (`lib/services/fitness-files/localFile.ts`) - File system storage
- `S3FitnessStorage` (`lib/services/fitness-files/S3StorageFile.ts`) - S3/Object storage
- Both implement the `FitnessStorage` interface

#### File Types Supported
- `.fit` - Garmin FIT files
- `.gpx` - GPS Exchange Format
- `.tcx` - Training Center XML

### 2. Database Schema

#### Migration (`migrations/20260211210400_add_fitness_files_table.js`)
Table: `fitness_files`
- `id` - Primary key
- `actorId` - Foreign key to actors table
- `statusId` - Optional foreign key to statuses table
- `path` - File path in storage
- `fileName` - Original file name
- `fileType` - File type (fit, gpx, tcx)
- `mimeType` - MIME type
- `bytes` - File size in bytes
- `description` - Optional description
- `hasMapData` - Flag indicating if file contains GPS data
- `mapImagePath` - Path to generated map image (for future use)
- `createdAt`, `updatedAt`, `deletedAt` - Timestamps

#### Database Operations (`lib/database/sql/fitnessFile.ts`)
- `createFitnessFile` - Create new fitness file record
- `getFitnessFile` - Retrieve fitness file by ID
- `getFitnessFilesByActor` - List fitness files for an actor
- `getFitnessFileByStatus` - Get fitness file associated with a status
- `deleteFitnessFile` - Soft delete fitness file
- `updateFitnessFileStatus` - Associate fitness file with a status

### 3. Counter Integration

Added to `lib/database/sql/utils/counter.ts`:
- `fitnessUsage(accountId)` - Total bytes used for fitness files
- `totalFitness(accountId)` - Total number of fitness files

These counters are automatically updated when fitness files are created or deleted, and they share the quota limit with media storage.

### 4. API Endpoints

#### Upload Endpoint
`POST /api/v1/fitness-files`
- Accepts multipart/form-data
- Fields: `file` (required), `description` (optional)
- Returns fitness file metadata including URL
- Validates file type and size
- Checks quota before upload

#### Retrieval Endpoint
`GET /api/v1/fitness-files/:id`
- Returns the fitness file content
- Supports both buffer response and redirect (for S3 with hostname)
- Sets appropriate cache headers

## What Still Needs Implementation

### 1. GPS Data Processing
- Parse .fit, .gpx, .tcx files to extract GPS coordinates
- Extract activity metadata (distance, duration, elevation, etc.)
- Suggested libraries:
  - `fit-file-parser` for .fit files
  - `gpxparser` or `@mapbox/togeojson` for .gpx files
  - `tcx-js` for .tcx files

### 2. Map Generation
- Generate static map images from GPS coordinates
- Use a map tile service (OpenStreetMap, Mapbox, etc.)
- Save generated map as a media attachment
- Store map image path in `fitness_files.mapImagePath`

### 3. PostBox Integration
- Add fitness file upload button to PostBox component
- Support single fitness file upload only
- Auto-set status visibility to "Private" when fitness file is attached
- Generate map image from GPS data and add as first attachment
- Create the status with fitness file association

### 4. Status Display
- Detect if status has an associated fitness file
- Display map visualization on status page
- Display route with elevation profile
- Display activity statistics (distance, time, pace, etc.)
- Add interactive charts for data visualization

### 5. ActivityPub Integration
- Include generated map image in ActivityPub Note
- Ensure map image is first in attachments array
- Add fitness activity metadata to Note properties

### 6. Testing
- Unit tests for fitness storage implementations
- Integration tests for API endpoints
- Tests for PostBox fitness file upload
- Tests for quota enforcement

## Usage Example

### Uploading a Fitness File

```typescript
const formData = new FormData()
formData.append('file', fitnessFile) // .fit, .gpx, or .tcx file
formData.append('description', 'Morning run')

const response = await fetch('/api/v1/fitness-files', {
  method: 'POST',
  body: formData,
  headers: {
    // Auth headers
  }
})

const result = await response.json()
// {
//   id: 'uuid',
//   type: 'fitness',
//   file_type: 'fit',
//   url: 'https://host/api/v1/fitness-files/uuid',
//   fileName: 'activity.fit',
//   size: 12345,
//   description: 'Morning run',
//   hasMapData: false
// }
```

### Retrieving a Fitness File

```typescript
const response = await fetch('/api/v1/fitness-files/uuid')
const blob = await response.blob()
// Use blob to download or process the file
```

## Next Steps

1. Implement GPS data parsing to extract coordinates and activity data
2. Implement map generation service (consider using Mapbox Static Images API or similar)
3. Update PostBox component to support fitness file upload
4. Create fitness activity display components for status pages
5. Integrate with ActivityPub for federation
6. Add comprehensive tests

## Security Considerations

- Fitness files may contain sensitive location data - ensure proper privacy controls
- Default visibility for fitness statuses is set to "Private"
- Quota enforcement prevents storage abuse
- File type validation prevents malicious uploads
