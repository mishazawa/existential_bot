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
    this.notifyAdmin = this.notifyAdmin.bind(this);


    this.bot.onText(/\/echo (.+)/, this.echoCallback);
    this.bot.onText(/\/cancel/, this.rejectCV);
    this.bot.onText(/\/create/, this.createCV);

    // getChatMember

    this.bot.on('callback_query', (cq) => {
      const [sudo, status, id] = cq.data.split('_');
      if (!sudo) return;
      if (status === 'approved') this.approveCV(+id, false); // ))))))))))
      if (status === 'rejected') this.rejectCV(+id, false);  // ))))))))))
      this.notifyUser(id, status);
      this.bot.deleteMessage(process.env.ADMIN_GROUP, cq.message.message_id);
    });

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
    if (msg.chat.type !== 'private') return;

    const record = this.db.get('cvs').find({ id: msg.chat.id });

    if (msg.text === '/create') {
      return;
    }

    if (!record.value()) {
      return this.bot.sendMessage(msg.chat.id, this.dictionary.create);
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
      this.notifyAdmin(msg.chat.id);
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

  notifyAdmin(id) {
    const db = this.db.get('cvs');
    const record = db.find({ id }).value();
    if (!record) return;
    this.bot.sendPhoto(process.env.ADMIN_GROUP, record.photo[0].file_id, {
      caption: this.genCaption(record.username, record.text),
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ok (еще не работает)', callback_data: `sudo_approved_${record.id}` }],
          [{ text: 'на хуй (еще не работает)', callback_data: `sudo_rejected_${record.id}` }],
        ],
      },
    });
  }

  notifyUser(id, status) {
    return this.bot.sendMessage(id, this.dictionary[status]);
  }

  approveCV(id, notify = true) {
    const record = this.db.get('cvs').find({ id });
    if (!record) return;

    let url;

    const { username, text } = record.value();
    const { file_id } = record.value().photo[0];

    record.assign({
      id: `10000${id}`,
      stage: 'approved',
    }).write();

    if (notify) return this.bot.sendMessage(id, this.dictionary.done); // mb useless...

    if (username) url = 'https://t.me/' + username;

    this.bot.sendPhoto(process.env.CHANNEL, file_id, {
      caption: this.genCaption(username, text),
      reply_markup: {
        inline_keyboard: [
          [{ text: username, callback_data: `bbwy_open_10000${id}`, url }],
        ],
      },
    });
  }

  rejectCV(msg, notify = true) {
    const id = msg.chat && msg.chat.id || msg;
    const record = this.db.get('cvs').find({ id });

    if (!record) return;

    record.assign({
      id: `00000${id}`,
      stage: 'rejected'
    }).write();

    if (notify) return this.bot.sendMessage(id, this.dictionary.done);
  }

  genCaption(username, text) {
    let txt = '';
    if (username) txt += username + '\n\n';
    txt += text;
    return txt;
  }

}

if (!module.parent) {
  __run__ = new Bot();
}

module.exports = Bot;
