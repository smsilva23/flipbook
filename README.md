# Collaborative Flipbook Server

A Node.js WebSocket server for an interactive and collaborative flipbook application with MongoDB storage.

## Features

- Real-time collaborative drawing updates via WebSocket
- MongoDB database for persistent storage of drawings
- REST API for frame management
- Multi-user support with room-based collaboration
- Cursor tracking for collaborative features

## Prerequisites

- Node.js (v18 or higher)
- MongoDB (local or cloud instance)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory:
```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/flipbook
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:3001
```

3. Make sure MongoDB is running on your system or update `MONGODB_URI` to point to your MongoDB instance.

## Running the Server

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The server will start on port 3000 (or the port specified in your `.env` file).

## API Endpoints

### REST API

- `GET /api/flipbook/:flipbookId/frames` - Get all frames for a flipbook
- `GET /api/flipbook/:flipbookId/frame/:frameIndex` - Get a specific frame
- `POST /api/flipbook/:flipbookId/frame/:frameIndex` - Save or update a frame
- `DELETE /api/flipbook/:flipbookId/frame/:frameIndex` - Delete a frame
- `GET /health` - Health check endpoint

### WebSocket Events

#### Client → Server

- `join-flipbook` - Join a flipbook room (requires flipbookId)
- `leave-flipbook` - Leave a flipbook room (requires flipbookId)
- `drawing-update` - Send drawing update (requires: flipbookId, frameIndex, drawingData, createdBy)
- `frame-delete` - Delete a frame (requires: flipbookId, frameIndex)
- `cursor-move` - Send cursor position (requires: flipbookId, x, y, userId)

#### Server → Client

- `flipbook-state` - Initial state when joining a flipbook
- `drawing-updated` - Broadcast when a drawing is updated
- `drawing-saved` - Confirmation that drawing was saved
- `frame-deleted` - Broadcast when a frame is deleted
- `cursor-updated` - Broadcast cursor position updates
- `drawing-error` - Error notification

## Database Schema

Each drawing is stored with:
- `flipbookId` - Unique identifier for the flipbook
- `frameIndex` - Index of the frame (0-based)
- `drawingData` - The actual drawing data (flexible schema)
- `createdAt` - Timestamp of creation
- `updatedAt` - Timestamp of last update
- `createdBy` - Identifier of the creator

## Example Client Connection

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000');

// Join a flipbook
socket.emit('join-flipbook', 'my-flipbook-id');

// Listen for updates
socket.on('drawing-updated', (data) => {
  console.log('Drawing updated:', data);
});

// Send a drawing update
socket.emit('drawing-update', {
  flipbookId: 'my-flipbook-id',
  frameIndex: 0,
  drawingData: { /* your drawing data */ },
  createdBy: 'user123'
});
```

## License

ISC

