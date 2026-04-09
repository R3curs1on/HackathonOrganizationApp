const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  name: String,
  mobile: { type: String, unique: true, required: true },
  team_name: String,
  lab_no: String,
  registered: { type: Boolean, default: false },
  is_present: { type: Boolean, default: false },
  has_redbull: { type: Boolean, default: false },
  has_dinner: { type: Boolean, default: false },
});

participantSchema.index({ team_name: 1 });
participantSchema.index({ registered: 1 });
participantSchema.index({ has_dinner: 1 });

module.exports = mongoose.model('Participant', participantSchema);
