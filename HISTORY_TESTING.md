# Testing the History Tracking System

## Prerequisites
- Server running on the configured port
- Valid JWT authentication token
- At least one PDF processed through `/pdf-to-text` endpoint

## Test Endpoints

### 1. Test PDF Processing (Creates History)

```bash
# Upload a PDF to create history entries
curl -X POST http://localhost:3000/pdf-to-text \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "pdfs=@/path/to/resume1.pdf" \
  -F "pdfs=@/path/to/resume2.pdf"
```

### 2. Get All History

```bash
# Get first page of history (20 items)
curl -X GET "http://localhost:3000/history" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Get second page with 10 items per page
curl -X GET "http://localhost:3000/history?page=2&limit=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Filter by process type
curl -X GET "http://localhost:3000/history?processType=pdf-to-text" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Filter by status
curl -X GET "http://localhost:3000/history?status=success" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Combine filters
curl -X GET "http://localhost:3000/history?processType=pdf-to-text&status=failed&page=1&limit=5" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Get History by Process Type

```bash
# Get all pdf-to-text history
curl -X GET "http://localhost:3000/history/pdf-to-text" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# With pagination
curl -X GET "http://localhost:3000/history/pdf-to-text?page=1&limit=15" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Get Single History Entry

```bash
# Replace HISTORY_ID with actual MongoDB ObjectId
curl -X GET "http://localhost:3000/history/entry/HISTORY_ID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Using Postman

### Setup
1. Create a new collection called "History Tracking"
2. Add environment variable `token` with your JWT token
3. Add environment variable `baseUrl` with your server URL (e.g., `http://localhost:3000`)

### Request Examples

#### Get All History
- **Method:** GET
- **URL:** `{{baseUrl}}/history`
- **Headers:** 
  - `Authorization: Bearer {{token}}`
- **Query Params:**
  - `page`: 1
  - `limit`: 20
  - `processType`: pdf-to-text (optional)
  - `status`: success (optional)

#### Get History by Process Type
- **Method:** GET
- **URL:** `{{baseUrl}}/history/pdf-to-text`
- **Headers:** 
  - `Authorization: Bearer {{token}}`
- **Query Params:**
  - `page`: 1
  - `limit`: 20

#### Get Single Entry
- **Method:** GET
- **URL:** `{{baseUrl}}/history/entry/{{historyId}}`
- **Headers:** 
  - `Authorization: Bearer {{token}}`

## Testing with JavaScript/Node.js

```javascript
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const TOKEN = 'your-jwt-token-here';

// Helper function for authenticated requests
const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${TOKEN}`
  }
});

// Test 1: Get all history
async function getAllHistory() {
  try {
    const response = await api.get('/history', {
      params: {
        page: 1,
        limit: 20
      }
    });
    console.log('All History:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Test 2: Get filtered history
async function getFilteredHistory() {
  try {
    const response = await api.get('/history', {
      params: {
        processType: 'pdf-to-text',
        status: 'success',
        page: 1,
        limit: 10
      }
    });
    console.log('Filtered History:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Test 3: Get history by process type
async function getHistoryByType() {
  try {
    const response = await api.get('/history/pdf-to-text');
    console.log('PDF Processing History:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Test 4: Get single history entry
async function getSingleHistory(historyId) {
  try {
    const response = await api.get(`/history/entry/${historyId}`);
    console.log('History Entry:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Run tests
(async () => {
  await getAllHistory();
  await getFilteredHistory();
  await getHistoryByType();
  // Replace with actual history ID
  // await getSingleHistory('507f1f77bcf86cd799439011');
})();
```

## Expected Responses

### Success Response (Get All History)
```json
{
  "success": true,
  "data": [
    {
      "_id": "67638a1b2c3d4e5f6a7b8c9d",
      "userId": "67638a1b2c3d4e5f6a7b8c9e",
      "userEmail": "user@example.com",
      "userName": "John Doe",
      "processType": "pdf-to-text",
      "filename": "resume.pdf",
      "parsedData": {
        "name": "Jane Smith",
        "email": "jane@example.com",
        "mobile": "+1234567890",
        "skillsets": ["JavaScript", "Python", "React"]
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
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### Error Response (Unauthorized)
```json
{
  "error": "Unauthorized"
}
```

### Error Response (Not Found)
```json
{
  "success": false,
  "message": "History entry not found"
}
```

## MongoDB Queries for Manual Testing

```javascript
// Connect to MongoDB
use Interest

// View all history entries
db.history.find().pretty()

// View history for specific user
db.history.find({ userEmail: "user@example.com" }).pretty()

// Count total history entries
db.history.countDocuments()

// View only successful processes
db.history.find({ status: "success" }).pretty()

// View only failed processes
db.history.find({ status: "failed" }).pretty()

// Get latest 10 entries
db.history.find().sort({ timestamp: -1 }).limit(10).pretty()

// Create index for better performance (recommended)
db.history.createIndex({ userId: 1, timestamp: -1 })
db.history.createIndex({ processType: 1 })
db.history.createIndex({ status: 1 })
```

## Performance Tips

1. **Create Indexes:**
   ```javascript
   db.history.createIndex({ userId: 1, timestamp: -1 })
   db.history.createIndex({ processType: 1 })
   db.history.createIndex({ status: 1 })
   ```

2. **Limit Results:** Always use pagination to avoid loading too much data

3. **Filter Early:** Use query parameters to filter on the server side

4. **Monitor Collection Size:** Consider implementing data retention policies if the collection grows too large
