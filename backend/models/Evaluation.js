const mongoose = require('mongoose');

const evaluationSchema = new mongoose.Schema(
  {
    team_name: { type: String, required: true, trim: true },
    lab_no: { type: String, default: '', trim: true },
    innovation: { type: Number, default: 0, min: 0 },
    technical: { type: Number, default: 0, min: 0 },
    impact: { type: Number, default: 0, min: 0 },
    presentation: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    remarks: { type: String, default: '', trim: true },
    evaluated_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

evaluationSchema.index({ team_name: 1 }, { unique: true });
evaluationSchema.index({ total: -1 });

module.exports = mongoose.model('Evaluation', evaluationSchema);
