const mongoose = require('mongoose');

const kittySchema = mongoose.Schema({
  id: Number,
  username: String,
  stage: String,
  text: String,
  is_published: {type: Boolean, default: false },
  is_rejected: {type: Boolean, default: false },
  is_canceled: {type: Boolean, default: false },
  create_date: { type: Date, default: Date.now },
  update_date: { type: Date, default: Date.now },
  hashtag: [String],
  photo: [{ file_id: String, file_size: Number, width: Number, height: Number }],
  like: [{ id: Number, is_bot: Boolean, first_name: String, username: String, language_code: String }],
  dislike: [{ id: Number, is_bot: Boolean, first_name: String, username: String, language_code: String }],
});

const Kitten = mongoose.model('Kitten', kittySchema);


module.exports = Kitten;
