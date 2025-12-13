import mongoose from 'mongoose';

const automationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  prompt: { type: String, required: true },
  workflow: { type: Object, required: true },
  requiredScopes: [String],
  missingScopes: [String],
  config: { type: Object, default: {} }, // Store configuration values
  active: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

automationSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('Automation', automationSchema);