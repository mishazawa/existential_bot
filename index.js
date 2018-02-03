const TelegramBot = require('node-telegram-bot-api');
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

require('dotenv').config();


let __run__;

class Bot {
  constructor(token = process.env.TOKEN) {
    this.dictionary = low(new FileSync('dictionary.json')).getState();
    this.db = low(new FileSync('db.json'));

    if (!this.db.has('posts').value()) {
      this.db.defaults({ cvs: [] }).write();
    }

    this.bot = new TelegramBot(token, { polling: true });

    this.echoCallback = this.echoCallback.bind(this);
    this.messageCallback = this.messageCallback.bind(this);
    this.createCV = this.createCV.bind(this);
    this.rejectCV = this.rejectCV.bind(this);


    this.bot.onText(/\/echo (.+)/, this.echoCallback);
    this.bot.onText(/\/cancel/, this.rejectCV);
    this.bot.onText(/\/reject (.+)/, this.rejectCV);
    this.bot.onText(/\/create/, this.createCV);

    this.bot.on('message', this.messageCallback);

    this.bot.on('polling_error', (error) => {
      console.log(error);  // => 'EFATAL'
    });
  }

  echoCallback(msg, match) {
    const chatId = msg.chat.id;
    const resp = match[1];
    this.bot.sendMessage(chatId, resp);
  }

  messageCallback(msg) {
    const record = this.db.get('cvs').find({ id: msg.chat.id });

    // if stage on start
    if (!record.value()) {
      return this.createCV(msg);
    }

    if (msg.entities && msg.text === '/cancel') return; // kostil

    if (record.value().stage === 'pending') {
      return this.bot.sendMessage(msg.chat.id, this.dictionary.cancel);
    }

    if (record.value().stage === 'info' && !msg.photo) {
      return this.bot.sendMessage( msg.chat.id, this.dictionary.attachPhoto);
    }

    if (record.value().stage === 'info' && msg.photo) {
      record.assign({
        stage: 'pending',
        photo: msg.photo,
      }).write();
      return this.bot.sendMessage(msg.chat.id, this.dictionary.cancel);
    }

    if (!msg.entities) {
      return this.bot.sendMessage( msg.chat.id, this.dictionary.hashtag);
    }

    record.assign({
        stage: 'info',
        text: msg.text,
        hashtag: msg.entities.map(item => msg.text.slice(item.offset, item.offset + item.length)),
      }).write();

    this.bot.sendMessage( msg.chat.id, this.dictionary.attachPhoto);
  }

  createCV(msg) {
    const chatId = msg.chat.id;
    const db = this.db.get('cvs');
    const record = db.find({ id: msg.chat.id });
    if (!record.value()) {
      db.push({
        id: msg.chat.id,
        username: `@${msg.from.username}`,
        stage: 'start',
      }).write()
    }
    this.bot.sendMessage(chatId, this.dictionary.welcome);
  }

  notifyAdmin() {}

  notifyUser() {}

  approveCV() {}

  rejectCV(msg, match=null) {
    if (match[1]) return console.log('bb', match)
    const record = this.db.get('cvs').find({ id: msg.chat.id });
    record.assign({
      id: `00000${msg.chat.id}`,
      stage: 'rejected'
    }).write();
    return this.bot.sendMessage(msg.chat.id, this.dictionary.done);
  }

}

if (!module.parent) {
  __run__ = new Bot();
}

module.exports = Bot;
