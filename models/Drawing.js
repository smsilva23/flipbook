import mongoose from 'mongoose';

const drawingSchema = new mongoose.Schema({
  flipbookId: {
    type: String,
    required: true,
    index: true
  },
  frameIndex: {
    type: Number,
    required: true
  },
  drawingData: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: String,
    default: 'anonymous'
  }
});

// Compound index for efficient queries
drawingSchema.index({ flipbookId: 1, frameIndex: 1 }, { unique: true });

// Update the updatedAt field before saving
drawingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('Drawing', drawingSchema);

