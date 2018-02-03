const TelegramBot = require('node-telegram-bot-api');

require('dotenv').config();

let __run__;

class Bot {
  constructor(token = process.env.TOKEN) {
    this.bot = new TelegramBot(token, { polling: true });
    this.echoCallback = this.echoCallback.bind(this);
    this.messageCallback = this.messageCallback.bind(this);


    this.bot.onText(/\/echo (.+)/, this.echoCallback);
    this.bot.on('message', this.messageCallback);

    this.bot.on('polling_error', (error) => {
      console.log(error.code);  // => 'EFATAL'
    });
  }

  echoCallback(msg, match) {
    const chatId = msg.chat.id;
    const resp = match[1];
    this.bot.sendMessage(chatId, resp);
  }

  messageCallback(msg) {
    const chatId = msg.chat.id;
    this.bot.sendMessage(chatId, 'Received your message');
  }
}

if (!module.parent) {
  __run__ = new Bot();
}

module.exports = Bot;
