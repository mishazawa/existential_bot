require('log-timestamp');

import { dictionary } from './dictionary';
import { /*testBotConfig as*/ botConfig } from './config';
import { init, getFirestore } from './firebase';

import * as TelegramBot from 'node-telegram-bot-api';
import * as firebase from "firebase/app";

const Log = console;

declare namespace Existence {
  type Photo = {
    file_id: string;
    file_size: number;
    width: number;
    height: number;
  };

  type Like = {
    id: number | string;
    is_bot: boolean;
    first_name: string;
    username: string;
    language_code: string;
  };

  type Person = {
    id: string;
    username: string;
    stage: string;
    text: string;
    is_published: boolean;
    is_rejected: boolean;
    is_canceled: boolean;
    create_date: Date;
    update_date: Date;
    hashtag: string[];
    photo: Photo[];
    like: Like[];
    dislike: Like[];
  };
}

let __run__;

const BOT_CONFIG = { polling: true };

const blankPersonData = (msg: TelegramBot.Message): Existence.Person => ({
  id: msg.chat.id.toString(),
  username: `@${msg.from.username}`,
  stage: 'start',
  text: null,
  is_published: false,
  is_rejected: false,
  is_canceled: false,
  create_date: new Date(),
  update_date: new Date(),
  hashtag: [] as string[],
  photo: [] as Existence.Photo[],
  like: [] as Existence.Like[],
  dislike: [] as Existence.Like[],
})

class ExistentialBot {

  parseCommand = (msg: TelegramBot.Message) => {
    if (msg.entities && msg.entities.some(ent => ent.type === 'bot_command')) return this.runCommand(msg);
    return this.answerToMessage(msg);
  }

  runCommand = (msg: TelegramBot.Message) => {
    const cmdEntitie = msg.entities.find(ent => ent.type === 'bot_command');
    const cmdText = msg.text.slice(cmdEntitie.offset, cmdEntitie.offset + cmdEntitie.length);
    return this.commands[cmdText] && this.commands[cmdText](msg);
  }

  startCommand = (msg: TelegramBot.Message) => {
    return this.bot.sendMessage(msg.chat.id, dictionary.startReply);
  }

  createCommand = (msg: TelegramBot.Message) => {
    this.startScript(msg, (err) => {
      if (err) return this.handleInputError(err, msg);
      return this.bot.sendMessage(msg.chat.id, dictionary.createReply);
    });
  }

  cancelCommand = (msg: TelegramBot.Message) => {
    this.fs.runTransaction(async (transaction) => {
      const personRef = await this.fs.collection('person').doc(msg.chat.id.toString()).get();
      if (!personRef.exists) return this.startCommand(msg)
      const { stage, is_published, is_canceled, is_rejected } = personRef.data() as Existence.Person;;

      if (!is_published && !is_canceled && !is_rejected && stage === 'pending') {
        transaction.update(personRef.ref, {
          stage: 'canceled',
          is_canceled: true,
        });
        return this.bot.sendMessage(msg.chat.id, dictionary.done);
      }
    }).catch(Log.error);
  }


  startScript = (msg: TelegramBot.Message, cb: (err: string | null) => void) => {
    if (!msg.from.username) return cb('NOUNAME');

    this.fs.runTransaction(async (transaction) => {
      const personRef = await this.fs.collection('person').doc(msg.chat.id.toString()).get();

      if (!personRef.exists) {
        /* check status*/
        transaction.set(personRef.ref, blankPersonData(msg));
        Log.info(personRef.data() as Existence.Person)
        return cb(null);
      }
      const personRefCopy = await this.fs.collection('person_copy').doc().get();
      const personOldData = personRef.data() as Existence.Person;

      transaction.set(personRefCopy.ref, personOldData);
      transaction.set(personRef.ref, blankPersonData(msg));
      Log.info(personRef.data() as Existence.Person)
      return cb(null);
    });
  }

  handleInputError = (error: string, msg: TelegramBot.Message) => {
    return this.bot.sendMessage(msg.chat.id, dictionary.errors[error]);
  }

  answerToMessage = (msg: TelegramBot.Message) => {
    this.fs.runTransaction(async (transaction) => {
      const personRef = await this.fs.collection('person').doc(msg.chat.id.toString()).get();
      if (!personRef.exists) return this.startCommand(msg);

      const person = personRef.data() as Existence.Person;

      if (person.stage === 'start') {
        if (!msg.entities || !msg.entities.some(ent => ent.type === 'hashtag')) {
          return this.bot.sendMessage(msg.chat.id, dictionary.hashtag);
        }

        transaction.update(personRef.ref, {
          stage: 'info',
          text: msg.text,
          hashtag: msg.entities.map(item => msg.text.slice(item.offset, item.offset + item.length)),
        });

        return this.bot.sendMessage(msg.chat.id, dictionary.attachPhoto);
      }

      if (person.stage === 'info') {
        if (!msg.photo) {
          return this.bot.sendMessage( msg.chat.id, dictionary.attachPhoto);
        }

        transaction.update(personRef.ref, {
          stage: 'pending',
          photo: msg.photo,
        });

        this.notifyAdmin(msg);
        return this.bot.sendMessage(msg.chat.id, dictionary.cancel);
      }

      if (person.stage === 'pending') {
        return this.bot.sendMessage(msg.chat.id, dictionary.cancel);
      }

    }).catch(Log.error);
  }

  notifyUser = (id: string, status: string) => {
    return this.bot.sendMessage(id, dictionary[status]);
  }

  notifyAdmin = (msg: TelegramBot.Message) => {
    this.fs.runTransaction(async (transaction) => {
      const personRef = await this.fs.collection('person').doc(msg.chat.id.toString()).get();
      if (!personRef.exists) return Log.warn(msg);

      const data = personRef.data() as Existence.Person;

      this.bot.sendPhoto(botConfig.admin_group, msg.photo[0].file_id, {
        caption: this.genCaption(data.username, data.text),
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ok (вроде работает)', callback_data: `sudo_approved_${data.id}` }],
            [{ text: 'на хуй (вроде работает)', callback_data: `sudo_rejected_${data.id}` }]
          ],
        },
      });
    }).catch(Log.error);
  }


  approveCV = (id: string, notify: boolean = true) => {
    this.fs.runTransaction(async (transaction) => {
      const personRef = await this.fs.collection('person').doc(id).get();
      if (!personRef.exists) return Log.warn(id);

      const person = personRef.data() as Existence.Person;
      const { stage, is_published, is_canceled, is_rejected, username, text, photo } = person;


      const { file_id } = photo[0];

      if (!is_published && !is_canceled && !is_rejected && stage === 'pending') {
        this.bot.sendPhoto(botConfig.channel, file_id, {
          caption: this.genCaption(username, text),
          reply_markup: {
            inline_keyboard: this.likeKeyboard(id),
          },
        });
        transaction.update(personRef.ref, {
          stage: 'approved',
          is_published: true,
        });
        Log.info(`Approved ${id}`)
      }
    }).catch(Log.error)
  }

  rejectCV = (id: string, notify: boolean = true) => {
    this.fs.runTransaction(async (transaction) => {
      const personRef = await this.fs.collection('person').doc(id).get();
      if (!personRef.exists) return Log.warn(id);

      const person = personRef.data() as Existence.Person;
      const { stage, is_published, is_canceled, is_rejected } = person;

      if (!is_published && !is_canceled && !is_rejected && stage === 'pending') {
        transaction.update(personRef.ref, {
          stage: 'rejected',
          is_rejected: true,
        });
        if (notify) return this.bot.sendMessage(id, dictionary.done);
      }
    }).catch(Log.error)
  }

  genCaption = (username: string, text: string): string => `${username}\n${text}`;

  likeKeyboard = (id: string, like: number = 0, dislike: number = 0) => {
    let prefix = '10000';
    return [[
      { text: `🍜 (${like})`, callback_data: `_like_${id}` },
      // { text: `💔 (${dislike})`, callback_data: `_dislike_${prefix}${id}` }
    ]]
  }

  messageCallback = (msg: TelegramBot.Message) => {
    if (msg.chat.type !== 'private') return;
    Log.info({ msg });
    return this.parseCommand(msg);
  }

  queryCallback = (cq: TelegramBot.CallbackQuery) => {
    const [sudo, status, id] = cq.data.split('_');

    if (sudo) {
      if (status === 'approved') this.approveCV(id, false);
      if (status === 'rejected') this.rejectCV(id, false);

      this.notifyUser(id, status);

      return this.bot.deleteMessage(botConfig.admin_group, cq.message.message_id.toString());
    }

    if (status === 'like' || status === 'dislike') {

      this.fs.runTransaction(async (transaction) => {
        const personRef = await this.fs.collection('person').doc(id).get();

        if (!personRef.exists) {
          return this.bot.editMessageReplyMarkup({} as TelegramBot.InlineKeyboardMarkup, {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
          });
        }

        const person = personRef.data() as Existence.Person;

        const like = person.like.find((ent: Existence.Like) => ent.id === cq.from.id);

        if (like) {
          transaction.update(personRef.ref, { like: firebase.firestore.FieldValue.arrayRemove(like) })
        } else {
          transaction.update(personRef.ref, { like: firebase.firestore.FieldValue.arrayUnion(cq.from as Existence.Like) })
        }
      }).then(async () => {
        const personRef = await this.fs.collection('person').doc(id).get();
        const person = personRef.data() as Existence.Person;

        this.bot.editMessageReplyMarkup({
          inline_keyboard: this.likeKeyboard(id, person.like.length)
        }, {
          chat_id: cq.message.chat.id,
          message_id: cq.message.message_id,
        }).catch(Log.error);

      }).catch(Log.error)
    }

  }

  errorCallback = (...args) => {
    Log.error(...args);
  }


  attachListeners = () => {
    this.bot.on('callback_query', this.queryCallback)
    this.bot.on('message', this.messageCallback);
    this.bot.on('polling_error', this.errorCallback);
  }

  private commands = {
    '/start': this.startCommand,
    '/create': this.createCommand,
    '/cancel': this.cancelCommand,
    '/help': null,
  };

  private errors = {
    'NOUNAME': null,
  };


  private bot: TelegramBot;
  private fs: firebase.firestore.Firestore;

  constructor (token: string) {
    init(() => {
      Log.info(`Firebase was initialized:)`)
      this.fs = getFirestore();
      this.bot = new TelegramBot(token, BOT_CONFIG);
      this.attachListeners();
      Log.info(`Bot started ${new Date()}`)
    })
  }
}

if (!module.parent) {
  __run__ = new ExistentialBot(botConfig.token);
}

export default ExistentialBot;
