# History Tracking System

## Overview
This system automatically tracks every document processing operation for each user in a MongoDB collection named `history`.

## Database Structure

### Collection: `history`
**Database:** `Interest`

### Document Schema
Each history entry contains the following fields:

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId - Reference to user's _id",
  "userEmail": "string - User's email address",
  "userName": "string - User's name (nullable)",
  "processType": "string - Type of process (e.g., 'pdf-to-text')",
  "filename": "string - Name of the processed file",
  "parsedData": "object - Extracted data from the document (nullable)",
  "error": "string - Error message if processing failed (nullable)",
  "status": "string - 'success' or 'failed'",
  "creditsUsed": "number - Credits consumed for this process",
  "timestamp": "Date - When the process occurred",
  "metadata": {
    "totalFiles": "number - Total files in the batch",
    "remainingCredits": "number - User's credits after this process"
  }
}
```

## API Endpoints

### 1. Get All History for User
**Endpoint:** `GET /history`

**Authentication:** Required (JWT Token)

**Query Parameters:**
- `page` (optional, default: 1) - Page number for pagination
- `limit` (optional, default: 20) - Number of records per page
- `processType` (optional) - Filter by process type (e.g., 'pdf-to-text')
- `status` (optional) - Filter by status ('success' or 'failed')

**Example Request:**
```bash
GET /history?page=1&limit=20&processType=pdf-to-text&status=success
Authorization: Bearer <your-jwt-token>
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "userId": "507f191e810c19729de860ea",
      "userEmail": "user@example.com",
      "userName": "John Doe",
      "processType": "pdf-to-text",
      "filename": "resume.pdf",
      "parsedData": {
        "name": "Jane Smith",
        "email": "jane@example.com",
        "mobile": "+1234567890"
      },
      "error": null,
      "status": "success",
      "creditsUsed": 1,
      "timestamp": "2025-12-19T01:00:00.000Z",
      "metadata": {
        "totalFiles": 3,
        "remainingCredits": 47
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

### 2. Get History by Process Type
**Endpoint:** `GET /history/:processType`

**Authentication:** Required (JWT Token)

**Path Parameters:**
- `processType` - Type of process to filter (e.g., 'pdf-to-text')

**Query Parameters:**
- `page` (optional, default: 1)
- `limit` (optional, default: 20)

**Example Request:**
```bash
GET /history/pdf-to-text?page=1&limit=10
Authorization: Bearer <your-jwt-token>
```

### 3. Get Single History Entry
**Endpoint:** `GET /history/entry/:id`

**Authentication:** Required (JWT Token)

**Path Parameters:**
- `id` - MongoDB ObjectId of the history entry

**Example Request:**
```bash
GET /history/entry/507f1f77bcf86cd799439011
Authorization: Bearer <your-jwt-token>
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f191e810c19729de860ea",
    "userEmail": "user@example.com",
    "userName": "John Doe",
    "processType": "pdf-to-text",
    "filename": "resume.pdf",
    "parsedData": {
      "name": "Jane Smith",
      "email": "jane@example.com"
    },
    "error": null,
    "status": "success",
    "creditsUsed": 1,
    "timestamp": "2025-12-19T01:00:00.000Z",
    "metadata": {
      "totalFiles": 1,
      "remainingCredits": 49
    }
  }
}
```

## How It Works

### Automatic Tracking
When a user processes documents through the `/pdf-to-text` endpoint:

1. **Before Processing:**
   - User authentication is verified
   - Credits are checked and deducted

2. **During Processing:**
   - Each PDF is processed by the AI model
   - Results (success or error) are collected

3. **After Processing:**
   - A history entry is created for **each processed file**
   - All entries are saved to the `history` collection
   - Response is sent to the user

### Data Retention
- All history entries are stored permanently
- Users can only access their own history (enforced by `userId` filter)
- No automatic deletion or cleanup (implement if needed)

## Usage Examples

### Frontend Integration

```javascript
// Fetch user's processing history
async function getUserHistory(page = 1, limit = 20) {
  const response = await fetch(`/history?page=${page}&limit=${limit}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
}

// Fetch only successful PDF conversions
async function getSuccessfulPDFs() {
  const response = await fetch('/history?processType=pdf-to-text&status=success', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
}

// Get details of a specific history entry
async function getHistoryDetails(historyId) {
  const response = await fetch(`/history/entry/${historyId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
}
```

## Future Enhancements

Consider adding:
1. **Delete History:** Allow users to delete their history entries
2. **Export History:** Export history as CSV/JSON
3. **Analytics:** Aggregate statistics (total processes, success rate, etc.)
4. **Search:** Full-text search across filenames and parsed data
5. **Filters:** Date range filters, advanced filtering options
6. **Webhooks:** Notify users when processing completes

## Security Notes

- All history endpoints require authentication
- Users can only access their own history
- Sensitive data in `parsedData` should be handled according to privacy policies
- Consider implementing data retention policies for compliance
