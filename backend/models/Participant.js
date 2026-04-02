const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  name: String,
  mobile: { type: String, unique: true, required: true },
  team_name: String,
  lab_no: String,
  is_present: { type: Boolean, default: false },
  has_redbull: { type: Boolean, default: false },
  has_dinner: { type: Boolean, default: false },
});

module.exports = mongoose.model('Participant', participantSchema);