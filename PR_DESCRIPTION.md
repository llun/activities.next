# Fix Edit Status Functionality with Consistent Response Format

## Problem

When editing a status in the PostBox component, the current implementation has several issues:

1. The PUT handler in the status API route returns a custom JSON response with only partial status information
2. This differs from the GET handler which uses `getMastodonStatus` to return a consistent, complete status object
3. The inconsistency between response formats can lead to issues when handling the edited status
4. The PostBox component uses manual URL parsing to extract status ID instead of the standard `urlToId` utility

## Solution

This PR fixes the edit status functionality by:

1. Updating the PUT handler in the status API route to use `getMastodonStatus` for a consistent response format
2. Modifying the client's `updateNote` function to handle the new response format
3. Keeping the PostBox component implementation unchanged for status updates
4. Using the standard `urlToId` utility function for status ID extraction

## Changes

1. In `app/api/v1/statuses/[id]/route.ts`:

   - Updated the PUT handler to use `getMastodonStatus` for the response, similar to the GET handler
   - Removed the custom JSON response format
   - Removed unused import

2. In `lib/client.ts`:

   - Updated the `updateNote` function to handle the new response format from `getMastodonStatus`
   - Maintained the same return structure to ensure compatibility with existing code

3. In `lib/components/PostBox/PostBox.tsx`:
   - Replaced manual URL parsing with `urlToId` utility function for status ID extraction
   - Added import for `urlToId` from utils

## Testing

The changes have been tested by:

- Editing a status and verifying that all properties are properly updated
- Ensuring the UI correctly reflects the updated status
- Confirming that the status is properly updated in the database
- Verifying that status ID extraction works correctly with the `urlToId` utility

## Screenshots

N/A
