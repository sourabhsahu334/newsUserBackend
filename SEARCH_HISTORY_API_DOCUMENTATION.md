# Search History API Documentation

## Overview
The Search History API allows users to search through their processed resume history by querying multiple fields including name, email, skills, company name, mobile number, college name, and current company.

---

## Endpoint

### POST `/st/search-history`

Searches through the authenticated user's history entries using a flexible multi-field search.

#### Authentication
Requires JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

#### Request Body
```json
{
  "query": "javascript",
  "page": 1,
  "limit": 20,
  "folderId": "my-folder" // optional
}
```

**Parameters:**
- `query` (string, required) - Search term to look for across all fields
- `page` (number, optional) - Page number for pagination (default: 1)
- `limit` (number, optional) - Number of results per page (default: 20)
- `folderId` (string, optional) - Filter results by specific folder

#### Response (Success - 200)
```json
{
  "success": true,
  "query": "javascript",
  "data": [
    {
      "_id": "...",
      "userId": "...",
      "userEmail": "user@example.com",
      "folderId": ["my-folder"],
      "filename": "resume.pdf",
      "parsedData": {
        "name": "John Doe",
        "email": "john@example.com",
        "mobile": "1234567890",
        "skillsets": ["JavaScript", "React", "Node.js"],
        "current_company": "Tech Corp",
        "collegename": "MIT",
        "experience": [
          {
            "company": "Google",
            "start_date": "01/2020",
            "end_date": "Present"
          }
        ]
      },
      "status": "success",
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1
  }
}
```

#### Response (Error - 400)
```json
{
  "success": false,
  "message": "Search query is required and must be a non-empty string"
}
```

---

## Search Fields

The search query will match against the following fields in `parsedData`:

1. **name** - Candidate's full name (case-insensitive)
2. **email** - Email address (case-insensitive)
3. **mobile** - Mobile/phone number
4. **skillsets** - Array of skills (case-insensitive)
5. **experience.company** - Company names in work experience (case-insensitive)
6. **current_company** - Current employer (case-insensitive)
7. **collegename** - College/university name (case-insensitive)

---

## Frontend Usage Examples

### Using Fetch API

```javascript
const searchHistory = async (searchQuery, page = 1, folderId = null) => {
  try {
    const requestBody = {
      query: searchQuery,
      page: page,
      limit: 20
    };
    
    if (folderId) {
      requestBody.folderId = folderId;
    }

    const response = await fetch('https://your-api-url.com/st/search-history', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${yourJwtToken}`
      },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log(`Found ${data.pagination.total} results for "${searchQuery}"`);
      console.log('Results:', data.data);
      return data;
    } else {
      console.error('Search failed:', data.message);
    }
  } catch (error) {
    console.error('Request failed:', error);
  }
};

// Usage examples
searchHistory("javascript");                    // Search for "javascript"
searchHistory("google", 1);                     // Search for "google", page 1
searchHistory("developer", 2, "my-folder");     // Search in specific folder
```

### Using Axios

```javascript
import axios from 'axios';

const searchHistory = async (searchQuery, page = 1, folderId = null) => {
  try {
    const requestBody = {
      query: searchQuery,
      page: page,
      limit: 20
    };
    
    if (folderId) {
      requestBody.folderId = folderId;
    }

    const response = await axios.post(
      'https://your-api-url.com/st/search-history',
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${yourJwtToken}`
        }
      }
    );
    
    console.log(`Found ${response.data.pagination.total} results`);
    return response.data;
  } catch (error) {
    console.error('Search error:', error.response?.data?.message || error.message);
  }
};
```

### React Component Example

```jsx
import React, { useState } from 'react';
import axios from 'axios';

function SearchHistory() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const response = await axios.post(
        '/st/search-history',
        { query, page: 1, limit: 20 },
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }
      );

      setResults(response.data.data);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSearch}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, skills, company..."
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {pagination && (
        <p>Found {pagination.total} results</p>
      )}

      <div>
        {results.map((item) => (
          <div key={item._id}>
            <h3>{item.parsedData?.name}</h3>
            <p>Email: {item.parsedData?.email}</p>
            <p>Skills: {item.parsedData?.skillsets?.join(', ')}</p>
            <p>Company: {item.parsedData?.current_company}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Search Behavior

### Case Sensitivity
- **Case-insensitive**: name, email, skillsets, company names, current_company, collegename
- **Case-sensitive**: mobile number

### Partial Matching
All fields support partial matching using regex. For example:
- Query `"java"` will match `"JavaScript"`, `"Java Developer"`, etc.
- Query `"@gmail"` will match any Gmail addresses
- Query `"tech"` will match `"TechCorp"`, `"FinTech Solutions"`, etc.

### Multiple Results
The search uses MongoDB's `$or` operator, so a single query can match multiple fields. For example, searching for `"google"` might return:
- Resumes with email `john@google.com`
- Resumes with `"Google"` in experience companies
- Resumes with `"Google"` in current_company

---

## Error Handling

### Common Error Codes
- **400**: Bad Request (empty or invalid query)
- **401**: Unauthorized (invalid or missing JWT token)
- **500**: Internal Server Error

### Error Response Format
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message"
}
```

---

## Performance Tips

1. **Be Specific**: More specific queries return faster results
2. **Use Pagination**: Don't request all results at once
3. **Filter by Folder**: Use `folderId` to narrow down search scope
4. **Limit Results**: Keep the `limit` parameter reasonable (20-50)

---

## Notes

1. **Authentication Required**: Endpoint requires valid JWT token
2. **User Isolation**: Only searches the authenticated user's history
3. **Success Only**: Only searches entries with `status: 'success'`
4. **Sorted by Date**: Results are sorted by timestamp (newest first)
5. **Premium Users**: History is only saved for premium users, so search results depend on user's premium status
