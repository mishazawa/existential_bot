const TelegramBot = require('node-telegram-bot-api');
const FileSync    = require('lowdb/adapters/FileSync');
const low         = require('lowdb');
const winston     = require('winston');
const mongoose    = require('mongoose');

const User        = require('./models/Kitty');

require('log-timestamp');
require('dotenv').config();

mongoose.connect(`mongodb://bot:${process.env.MONGO_PASS}@${process.env.MONGO_URL}`);


let __run__;

class Bot {
  constructor(token = process.env.TOKEN) {

    this.dictionary = low(new FileSync('dictionary.json')).getState();

    this.log = winston.createLogger({
      format: winston.format.json(),
      transports: [
        new winston.transports.File({ filename: './info.log', level: 'info' }),
        new winston.transports.File({ filename: './error.log', level: 'error' }),
      ]
    });

    mongoose.connection.on('error', this.log.error.bind(this.log.error, 'connection error:'));
    mongoose.connection.once('open', () => {
      this.log.info('Mongo is up.');
    });

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
        User.findOne({_id:id}).then((record) => {

          // rm inline keyboard if no record in db
          if (!record) {
            this.bot.editMessageReplyMarkup({}, {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
            });
          }

          let request = '$push';
          let likeLen = record.like.length + 1;

          if (record.like.some(ent => ent.id === cq.from.id)) {
            request = '$pull';
            likeLen -= 2;
          }

          User.findByIdAndUpdate(id, { [request]: { like: cq.from }}).then(() => {
            this.bot.editMessageReplyMarkup({
              inline_keyboard: this.likeKeyboard(id, likeLen)
            }, {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
            }).catch(this.log.error);
          }).catch(this.log.error);
        });
      }
    });

    this.bot.on('message', this.messageCallback);

    this.bot.on('polling_error', this.log.error);
  }

  runBotCommand(msg) {
    const cmdEntitie = msg.entities.find(ent => ent.type === 'bot_command');
    const cmdText = msg.text.slice(cmdEntitie.offset, cmdEntitie.offset + cmdEntitie.length);
    return this.commands[cmdText] && this.commands[cmdText](msg);
  }

  startCommand(msg) {
    return this.bot.sendMessage(msg.chat.id, this.dictionary.startReply).catch(this.log.error);
  }

  createCommand(msg) {
    this.startScript(msg, (err) => {
      if (err) return this.handleInputError(err, msg);
      return this.bot.sendMessage(msg.chat.id, this.dictionary.createReply).catch(this.log.error);
    });
  }

  cancelCommand(msg) {
    User.findOne({
      id: msg.chat.id,
      is_published: false,
      is_canceled: false,
      is_rejected: false,
    }).then((record) => {
      if (!record) return this.startCommand(msg);
      User.update({_id: record._id}, {
        stage: 'canceled',
        is_canceled: true,
      }).then(() => {
        return this.bot.sendMessage(msg.chat.id, this.dictionary.done).catch(this.log.error);
      }).catch(this.log.error);
    })
  }

  handleInputError(err, msg) {
    return this.bot.sendMessage(msg.chat.id, this.dictionary.errors[err]);
  }

  startScript(msg, cb) {
    if (!msg.from.username) return cb('NOUNAME');

    User.findOne({
      id: msg.chat.id,
      is_published: false,
      is_canceled: false,
      is_rejected: false,
    }).then((data) => {
      if (!data) {
        User.create({
          id: msg.chat.id,
          username: `@${msg.from.username}`,
          stage: 'start',
        }).then(this.log.info).catch(this.log.error);
      }
      return cb(null);
    }).catch(this.log.error);
  }

  answerToMessage(msg) {
    User.findOne({
      id: msg.chat.id,
      is_published: false,
      is_canceled: false,
      is_rejected: false,
    }).then((record) => {
      if (!record) {
        return this.startCommand(msg);
      }

      if (record.stage === 'start') {
        if (!msg.entities || !msg.entities.some(ent => ent.type === 'hashtag')) {
          return this.bot.sendMessage( msg.chat.id, this.dictionary.hashtag);
        }

        User.update({ _id: record._id }, {
          $set: {
            stage: 'info',
            text: msg.text,
            hashtag: msg.entities.map(item => msg.text.slice(item.offset, item.offset + item.length)),
          }
        }).then(() => this.bot.sendMessage( msg.chat.id, this.dictionary.attachPhoto)).catch(this.log.error);
      }

      if (record.stage === 'info') {
        if (!msg.photo) {
          return this.bot.sendMessage( msg.chat.id, this.dictionary.attachPhoto);
        }

        User.update({ _id: record._id }, {
          $set: {
            stage: 'pending',
            photo: msg.photo,
          }
        }).then(() => {
          this.notifyAdmin(msg.chat.id);
          return this.bot.sendMessage(msg.chat.id, this.dictionary.cancel);
        }).catch(this.log.error);

      }
      if (record.stage === 'pending') {
        return this.bot.sendMessage(msg.chat.id, this.dictionary.cancel);
      }
    });
  }

  messageCallback(msg) {
    if (msg.chat.type !== 'private') return;
    this.log.info({ msg });
    return this.parseCommand(msg);
  }

  notifyAdmin(id) {
    User.findOne({
      id,
      is_published: false,
      is_canceled: false,
      is_rejected: false,
    }).then((record) => {
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
    }).catch(this.log.error);
  }

  notifyUser(id, status) {
    return this.bot.sendMessage(id, this.dictionary[status]);
  }

  approveCV(id, notify = true) {
    User.findOne({
      id,
      stage: 'pending',
      is_published: false,
      is_canceled: false,
      is_rejected: false,
    }).then((record) => {
      if (!record) return;

      const { username, text } = record;
      const { file_id } = record.photo[0];

      User.update({ _id: record._id }, {
        stage: 'approved',
        is_published: true,
      }).then(() => {
        this.bot.sendPhoto(process.env.CHANNEL, file_id, {
          caption: this.genCaption(username, text),
          reply_markup: {
            inline_keyboard: this.likeKeyboard(record._id),
          },
        });
      }).catch(this.log.error);
    }).catch(this.log.error);
  }

  rejectCV(msg, notify = true) {
    const id = msg.chat && msg.chat.id || msg;
    User.findOne({
      id,
      stage: 'pending',
      is_published: false,
      is_canceled: false,
      is_rejected: false,
    }).then((record) => {
      if (!record) return;
      User.update({_id: record._id}, {
        stage: 'rejected',
        is_rejected: true,
      }).then(() => {
        if (notify) return this.bot.sendMessage(id, this.dictionary.done);
      }).catch(this.log.error);
    }).catch(this.log.error);
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
      { text: `🍜 (${like})`, callback_data: `_like_${prefix}${id}` },
      // { text: `💔 (${dislike})`, callback_data: `_dislike_${prefix}${id}` }
    ]]
  }
}

if (!module.parent) {
  __run__ = new Bot();
}

module.exports = Bot;
