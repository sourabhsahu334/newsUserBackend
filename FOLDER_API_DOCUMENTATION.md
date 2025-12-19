# Folder Management API Documentation

## Overview
These endpoints allow users to create and manage folders by storing folder names in the `folderTypes` array field in the user document.

---

## Endpoints

### 1. Create Folder
**POST** `/create-folder`

Creates a new folder by adding the folder name to the user's `folderTypes` array.

#### Authentication
Requires JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

#### Request Body
```json
{
  "folderName": "My Documents"
}
```

#### Response (Success - 200)
```json
{
  "success": true,
  "message": "Folder created successfully",
  "folderTypes": ["My Documents", "Work Files", "Personal"]
}
```

#### Response (Error - 400)
```json
{
  "success": false,
  "message": "Folder name is required and must be a string"
}
```

#### Features
- **Duplicate Prevention**: Uses MongoDB's `$addToSet` operator to prevent duplicate folder names
- **Validation**: Ensures folder name is a non-empty string
- **Auto-trim**: Automatically trims whitespace from folder names

---

### 2. Get Folders
**GET** `/folders`

Retrieves all folder names for the authenticated user.

#### Authentication
Requires JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

#### Response (Success - 200)
```json
{
  "success": true,
  "folderTypes": ["My Documents", "Work Files", "Personal"]
}
```

#### Response (No folders - 200)
```json
{
  "success": true,
  "folderTypes": []
}
```

---

## Frontend Usage Examples

### Using Fetch API

#### Create Folder
```javascript
const createFolder = async (folderName) => {
  try {
    const response = await fetch('https://your-api-url.com/create-folder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${yourJwtToken}`
      },
      body: JSON.stringify({ folderName })
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('Folder created:', data.folderTypes);
    } else {
      console.error('Error:', data.message);
    }
  } catch (error) {
    console.error('Request failed:', error);
  }
};

// Usage
createFolder("My New Folder");
```

#### Get Folders
```javascript
const getFolders = async () => {
  try {
    const response = await fetch('https://your-api-url.com/folders', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${yourJwtToken}`
      }
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('User folders:', data.folderTypes);
      return data.folderTypes;
    }
  } catch (error) {
    console.error('Request failed:', error);
  }
};

// Usage
const folders = await getFolders();
```

### Using Axios

#### Create Folder
```javascript
import axios from 'axios';

const createFolder = async (folderName) => {
  try {
    const response = await axios.post(
      'https://your-api-url.com/create-folder',
      { folderName },
      {
        headers: {
          'Authorization': `Bearer ${yourJwtToken}`
        }
      }
    );
    
    console.log('Folder created:', response.data.folderTypes);
  } catch (error) {
    console.error('Error:', error.response?.data?.message || error.message);
  }
};
```

#### Get Folders
```javascript
import axios from 'axios';

const getFolders = async () => {
  try {
    const response = await axios.get(
      'https://your-api-url.com/folders',
      {
        headers: {
          'Authorization': `Bearer ${yourJwtToken}`
        }
      }
    );
    
    return response.data.folderTypes;
  } catch (error) {
    console.error('Error:', error.response?.data?.message || error.message);
  }
};
```

---

## Database Schema

The `folderTypes` field is added to the user document:

```javascript
{
  _id: ObjectId("..."),
  email: "user@example.com",
  name: "John Doe",
  credits: 100,
  folderTypes: ["My Documents", "Work Files", "Personal"],
  // ... other user fields
}
```

---

## Error Handling

### Common Error Codes
- **400**: Bad Request (invalid or missing folder name)
- **401**: Unauthorized (invalid or missing JWT token)
- **404**: User not found
- **500**: Internal Server Error

### Error Response Format
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message (only in development)"
}
```

---

## Notes

1. **Authentication Required**: Both endpoints require a valid JWT token
2. **Duplicate Prevention**: The same folder name cannot be added twice
3. **Case Sensitive**: Folder names are case-sensitive ("Work" and "work" are different)
4. **No Limit**: Currently no limit on the number of folders a user can create
5. **Whitespace Handling**: Leading and trailing whitespace is automatically removed
