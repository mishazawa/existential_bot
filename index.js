const TelegramBot = require('node-telegram-bot-api');
const FileSync = require('lowdb/adapters/FileSync');
const low = require('lowdb');
const winston = require('winston');

require('dotenv').config();

let __run__;

class Bot {
  constructor(token = process.env.TOKEN) {
    this.db = low(new FileSync('db.json'));
    this.dictionary = low(new FileSync('dictionary.json')).getState();

    this.log = winston.createLogger({
      format: winston.format.json(),
      transports: [
        new winston.transports.File({ filename: './info.log', level: 'info' }),
        new winston.transports.File({ filename: './error.log', level: 'error' }),
        new winston.transports.File({ filename: './combined.log' })
      ]
    });


    if (!this.db.has('posts').value()) {
      this.db.defaults({ cvs: [] }).write();
    }

    this.messageCallback = this.messageCallback.bind(this);
    this.rejectCV = this.rejectCV.bind(this);
    this.notifyAdmin = this.notifyAdmin.bind(this);

    this.parseCommand = this.parseCommand.bind(this);
    this.runBotCommand = this.runBotCommand.bind(this);
    this.startCommand = this.startCommand.bind(this);
    this.startScript = this.startScript.bind(this);
    this.createCommand = this.createCommand.bind(this);
    this.cancelCommand = this.cancelCommand.bind(this);

    this.commands = {
      '/start': this.startCommand,
      '/create': this.createCommand,
      '/cancel': this.cancelCommand,
      '/help': null,
    };

    this.errors = {
      'NOUNAME': null,
    };

    this.bot = new TelegramBot(token, { polling: true });
    this.log.info(`Bot start ${new Date()}`)
    // getChatMember

    this.bot.on('callback_query', (cq) => {
      const [sudo, status, id] = cq.data.split('_');

      if (sudo) {
        if (status === 'approved') this.approveCV(+id, false); // ))))))))))
        if (status === 'rejected') this.rejectCV(+id, false);  // ))))))))))
        this.notifyUser(id, status);
        return this.bot.deleteMessage(process.env.ADMIN_GROUP, cq.message.message_id);
      }

      if (status === 'like' || status === 'dislike') {
        this.log.info({ cq });

        const record = this.db.get('cvs').find({ id });
        const value = record.value();

        // rm inline keyboard if no record in db
        if (!value) {
          this.bot.editMessageReplyMarkup({}, {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
          });
        }

        const alreadyLiked = value.like.some(ent => ent.id === cq.from.id);
        const alreadyDisliked = value.dislike.some(ent => ent.id === cq.from.id);

        if (alreadyLiked || alreadyDisliked) {
          value.like = value.like.filter(ent => ent.id !== cq.from.id);
          value.dislike = value.dislike.filter(ent => ent.id !== cq.from.id);
        }

        if ((!alreadyLiked && status === 'like') || (!alreadyDisliked && status === 'dislike')) {
          value[status].push(cq.from);
        }

        record.assign({
          like: value.like,
          dislike: value.dislike,
        }).write();

        this.bot.editMessageReplyMarkup({
            inline_keyboard: this.likeKeyboard(id, value.like.length, value.dislike.length)
          }, {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
          });
      }
    });

    this.bot.on('message', this.messageCallback);

    this.bot.on('polling_error', (error) => {
      console.log(error)
      this.log.error({ error });
    });
  }

  runBotCommand(msg) {
    const cmdEntitie = msg.entities.find(ent => ent.type === 'bot_command');
    const cmdText = msg.text.slice(cmdEntitie.offset, cmdEntitie.offset + cmdEntitie.length);
    return this.commands[cmdText] && this.commands[cmdText](msg);
  }

  startCommand(msg) {
    return this.bot.sendMessage(msg.chat.id, this.dictionary.startReply);
  }

  createCommand(msg) {
    this.startScript(msg, (err) => {
      if (err) return this.handleInputError(err, msg);
      return this.bot.sendMessage(msg.chat.id, this.dictionary.createReply);
    });
  }

  cancelCommand(msg) {
    const record = this.db.get('cvs').find({ id: msg.chat.id });

    if (!record) return this.startCommand(msg);

    record.assign({
      id: `00000${msg.chat.id}`,
      stage: 'canceled'
    }).write();

    return this.bot.sendMessage(msg.chat.id, this.dictionary.done);
  }

  handleInputError(err, msg) {
    return this.bot.sendMessage(msg.chat.id, this.dictionary.errors[err]);
  }

  startScript(msg, cb) {
    if (!msg.from.username) return cb('NOUNAME');

    const record = this.db.get('cvs').find({ id: msg.chat.id });

    if (!record.value()) {
      this.db.get('cvs').push({
        id: msg.chat.id,
        username: `@${msg.from.username}`,
        stage: 'start',
        create_date: new Date(),
      }).write()
    }
    return cb(null);
  }

  answerToMessage(msg) {
    const record = this.db.get('cvs').find({ id: msg.chat.id });

    if (!record.value()) {
      return this.startCommand(msg);
    }

    // write info about user
    if (record.value().stage === 'start') {
      if (!msg.entities || !msg.entities.some(ent => ent.type === 'hashtag')) {
        return this.bot.sendMessage( msg.chat.id, this.dictionary.hashtag);
      }

      record.assign({
        stage: 'info',
        text: msg.text,
        update_date: new Date(),
        hashtag: msg.entities.map(item => msg.text.slice(item.offset, item.offset + item.length)),
      }).write();

      return this.bot.sendMessage( msg.chat.id, this.dictionary.attachPhoto);
    }

    // attach photo
    if (record.value().stage === 'info') {
      if (!msg.photo) {
        return this.bot.sendMessage( msg.chat.id, this.dictionary.attachPhoto);
      }

      record.assign({
        stage: 'pending',
        photo: msg.photo,
      }).write();

      this.notifyAdmin(msg.chat.id);

      return this.bot.sendMessage(msg.chat.id, this.dictionary.cancel);
    }

    // cancel reply
    if (record.value().stage === 'pending') {
      return this.bot.sendMessage(msg.chat.id, this.dictionary.cancel);
    }
  }

  messageCallback(msg) {
    if (msg.chat.type !== 'private') return;
    this.log.info({ msg });
    return this.parseCommand(msg);
  }

  notifyAdmin(id) {
    const db = this.db.get('cvs');
    const record = db.find({ id }).value();
    if (!record) return;
    this.bot.sendPhoto(process.env.ADMIN_GROUP, record.photo[0].file_id, {
      caption: this.genCaption(record.username, record.text),
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ok (вроде работает)', callback_data: `sudo_approved_${record.id}` }],
          [{ text: 'на хуй (вроде работает)', callback_data: `sudo_rejected_${record.id}` }]
        ],
      },
    });
  }

  notifyUser(id, status) {
    return this.bot.sendMessage(id, this.dictionary[status]);
  }

  approveCV(id, notify = true) {
    const record = this.db.get('cvs').find({ id });

    if (!record.value()) return;

    let url;

    const { username, text } = record.value();
    const { file_id } = record.value().photo[0];

    record.assign({
      id: `10000${id}`,
      stage: 'approved',
      like: [],
      dislike: [],
    }).write();

    this.bot.sendPhoto(process.env.CHANNEL, file_id, {
      caption: this.genCaption(username, text),
      reply_markup: {
        inline_keyboard: this.likeKeyboard(id),
      },
    });
  }

  rejectCV(msg, notify = true) {
    const id = msg.chat && msg.chat.id || msg;
    const record = this.db.get('cvs').find({ id });

    if (!record.value()) return;

    record.assign({
      id: `00000${id}`,
      stage: 'rejected'
    }).write();

    if (notify) return this.bot.sendMessage(id, this.dictionary.done);
  }

  genCaption(username, text) {
    return `${username}\n${text}`;
  }

  parseCommand(msg) {
    if (msg.entities && msg.entities.some(ent => ent.type === 'bot_command')) {
      return this.runBotCommand(msg);
    }
    return this.answerToMessage(msg);
  }

  likeKeyboard(id, like = 0, dislike = 0) {
    let prefix = '';
    if (typeof id === 'number') prefix = '10000';
    return [[
      { text: `❤️ (${like})`, callback_data: `_like_${prefix}${id}` },
      { text: `💔 (${dislike})`, callback_data: `_dislike_${prefix}${id}` }
    ]]
  }
}

if (!module.parent) {
  __run__ = new Bot();
}

module.exports = Bot;
