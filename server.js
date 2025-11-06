import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { connectDB } from './config/database.js';
import Drawing from './models/Drawing.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(join(__dirname, 'public')));

// Connect to MongoDB
connectDB();

// Root route - Serve the flipbook app
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// API info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    message: 'Collaborative Flipbook Server',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api: {
        getFrames: 'GET /api/flipbook/:flipbookId/frames',
        getFrame: 'GET /api/flipbook/:flipbookId/frame/:frameIndex',
        saveFrame: 'POST /api/flipbook/:flipbookId/frame/:frameIndex',
        deleteFrame: 'DELETE /api/flipbook/:flipbookId/frame/:frameIndex'
      },
      websocket: {
        connection: 'ws://localhost:3000',
        events: [
          'join-flipbook',
          'leave-flipbook',
          'drawing-update',
          'frame-delete',
          'cursor-move'
        ]
      }
    },
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// REST API Routes

// Get all frames for a flipbook
app.get('/api/flipbook/:flipbookId/frames', async (req, res) => {
  try {
    const { flipbookId } = req.params;
    const drawings = await Drawing.find({ flipbookId })
      .sort({ frameIndex: 1 })
      .exec();
    res.json(drawings);
  } catch (error) {
    console.error('Error fetching frames:', error);
    res.status(500).json({ error: 'Failed to fetch frames' });
  }
});

// Get a specific frame
app.get('/api/flipbook/:flipbookId/frame/:frameIndex', async (req, res) => {
  try {
    const { flipbookId, frameIndex } = req.params;
    const drawing = await Drawing.findOne({ 
      flipbookId, 
      frameIndex: parseInt(frameIndex) 
    });
    
    if (!drawing) {
      return res.status(404).json({ error: 'Frame not found' });
    }
    
    res.json(drawing);
  } catch (error) {
    console.error('Error fetching frame:', error);
    res.status(500).json({ error: 'Failed to fetch frame' });
  }
});

// Save or update a frame
app.post('/api/flipbook/:flipbookId/frame/:frameIndex', async (req, res) => {
  try {
    const { flipbookId, frameIndex } = req.params;
    const { drawingData, createdBy } = req.body;
    
    const drawing = await Drawing.findOneAndUpdate(
      { flipbookId, frameIndex: parseInt(frameIndex) },
      { 
        drawingData, 
        createdBy: createdBy || 'anonymous',
        updatedAt: Date.now()
      },
      { 
        upsert: true, 
        new: true 
      }
    );
    
    res.json(drawing);
  } catch (error) {
    console.error('Error saving frame:', error);
    res.status(500).json({ error: 'Failed to save frame' });
  }
});

// Delete a frame
app.delete('/api/flipbook/:flipbookId/frame/:frameIndex', async (req, res) => {
  try {
    const { flipbookId, frameIndex } = req.params;
    await Drawing.findOneAndDelete({ 
      flipbookId, 
      frameIndex: parseInt(frameIndex) 
    });
    res.json({ message: 'Frame deleted successfully' });
  } catch (error) {
    console.error('Error deleting frame:', error);
    res.status(500).json({ error: 'Failed to delete frame' });
  }
});

// Get list of all flipbooks
app.get('/api/flipbooks', async (req, res) => {
  try {
    const flipbooks = await Drawing.aggregate([
      {
        $group: {
          _id: '$flipbookId',
          frameCount: { $sum: 1 },
          lastUpdated: { $max: '$updatedAt' },
          createdAt: { $min: '$createdAt' }
        }
      },
      {
        $project: {
          flipbookId: '$_id',
          frameCount: 1,
          lastUpdated: 1,
          createdAt: 1,
          _id: 0
        }
      },
      {
        $sort: { lastUpdated: -1 }
      }
    ]);
    
    res.json(flipbooks);
  } catch (error) {
    console.error('Error fetching flipbooks:', error);
    res.status(500).json({ error: 'Failed to fetch flipbooks' });
  }
});

// Get flipbook info
app.get('/api/flipbook/:flipbookId/info', async (req, res) => {
  try {
    const { flipbookId } = req.params;
    const drawings = await Drawing.find({ flipbookId });
    
    const info = {
      flipbookId,
      frameCount: drawings.length,
      lastUpdated: drawings.length > 0 
        ? new Date(Math.max(...drawings.map(d => new Date(d.updatedAt).getTime())))
        : null,
      createdAt: drawings.length > 0
        ? new Date(Math.min(...drawings.map(d => new Date(d.createdAt).getTime())))
        : null,
      creators: [...new Set(drawings.map(d => d.createdBy).filter(Boolean))]
    };
    
    res.json(info);
  } catch (error) {
    console.error('Error fetching flipbook info:', error);
    res.status(500).json({ error: 'Failed to fetch flipbook info' });
  }
});

// Delete a flipbook (all frames)
app.delete('/api/flipbook/:flipbookId', async (req, res) => {
  try {
    const { flipbookId } = req.params;
    const result = await Drawing.deleteMany({ flipbookId });
    
    // Broadcast deletion to all clients in the flipbook room
    io.to(flipbookId).emit('flipbook-deleted', { flipbookId });
    
    res.json({ 
      message: 'Flipbook deleted successfully',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting flipbook:', error);
    res.status(500).json({ error: 'Failed to delete flipbook' });
  }
});

// Rename a flipbook
app.put('/api/flipbook/:flipbookId/rename', async (req, res) => {
  try {
    const { flipbookId } = req.params;
    const { newFlipbookId } = req.body;
    
    if (!newFlipbookId || newFlipbookId.trim() === '') {
      return res.status(400).json({ error: 'New flipbook ID is required' });
    }
    
    const trimmedNewId = newFlipbookId.trim();
    
    // Check if new name already exists
    const existing = await Drawing.findOne({ flipbookId: trimmedNewId });
    if (existing) {
      return res.status(400).json({ error: 'A flipbook with this name already exists' });
    }
    
    // Update all drawings with the new flipbook ID
    const result = await Drawing.updateMany(
      { flipbookId },
      { $set: { flipbookId: trimmedNewId } }
    );
    
    // Broadcast rename to all clients
    io.to(flipbookId).emit('flipbook-renamed', { 
      oldFlipbookId: flipbookId,
      newFlipbookId: trimmedNewId
    });
    
    res.json({ 
      message: 'Flipbook renamed successfully',
      oldFlipbookId: flipbookId,
      newFlipbookId: trimmedNewId,
      updatedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Error renaming flipbook:', error);
    res.status(500).json({ error: 'Failed to rename flipbook' });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  // Join a flipbook room
  socket.on('join-flipbook', async (flipbookId) => {
    socket.join(flipbookId);
    console.log(`📚 Socket ${socket.id} joined flipbook: ${flipbookId}`);
    
    // Send current state of the flipbook to the new client
    try {
      const drawings = await Drawing.find({ flipbookId })
        .sort({ frameIndex: 1 })
        .exec();
      socket.emit('flipbook-state', drawings);
    } catch (error) {
      console.error('Error sending flipbook state:', error);
    }
  });

  // Leave a flipbook room
  socket.on('leave-flipbook', (flipbookId) => {
    socket.leave(flipbookId);
    console.log(`📚 Socket ${socket.id} left flipbook: ${flipbookId}`);
  });

  // Handle drawing updates
  socket.on('drawing-update', async (data) => {
    try {
      const { flipbookId, frameIndex, drawingData, createdBy } = data;
      
      // Save to database
      const drawing = await Drawing.findOneAndUpdate(
        { flipbookId, frameIndex },
        { 
          drawingData, 
          createdBy: createdBy || socket.id,
          updatedAt: Date.now()
        },
        { 
          upsert: true, 
          new: true 
        }
      );
      
      // Broadcast to all other clients in the same flipbook room
      socket.to(flipbookId).emit('drawing-updated', {
        flipbookId,
        frameIndex,
        drawingData,
        createdBy: drawing.createdBy,
        updatedAt: drawing.updatedAt
      });
      
      // Confirm to sender
      socket.emit('drawing-saved', {
        flipbookId,
        frameIndex,
        success: true
      });
    } catch (error) {
      console.error('Error handling drawing update:', error);
      socket.emit('drawing-error', { error: 'Failed to save drawing' });
    }
  });

  // Handle frame deletion
  socket.on('frame-delete', async (data) => {
    try {
      const { flipbookId, frameIndex } = data;
      
      await Drawing.findOneAndDelete({ flipbookId, frameIndex });
      
      // Broadcast deletion to all clients in the flipbook room
      io.to(flipbookId).emit('frame-deleted', {
        flipbookId,
        frameIndex
      });
    } catch (error) {
      console.error('Error handling frame deletion:', error);
      socket.emit('drawing-error', { error: 'Failed to delete frame' });
    }
  });

  // Handle cursor/pointer updates for collaborative features
  socket.on('cursor-move', (data) => {
    const { flipbookId, x, y, userId } = data;
    socket.to(flipbookId).emit('cursor-updated', {
      socketId: socket.id,
      userId,
      x,
      y
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready for connections`);
});

