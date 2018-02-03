const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const requestPromise = require('request-promise');
const { expect } = require('chai');
require('dotenv').config();

function request(uri) {
  return requestPromise({
    uri,
    json: true,
  });
}

const apis = {
  getMe: `https://api.telegram.org/bot${process.env.TOKEN}/getMe`,
  sendMessage: `https://api.telegram.org/bot${process.env.TOKEN}/sendMessage?chat_id=${process.env.CHAT}&text=`
}

describe('Existential Bot Test', () => {
  it('should return bot', (done) => {
    request(apis.getMe).then((resp) => {

      expect(resp.ok).to.equal(true);
      expect(resp.result.id).to.be.an('number');
      expect(resp.result.is_bot).to.equal(true);
      expect(resp.result.username).to.equal('existential_datings_bot');

      done();
    }).catch(done);
  });

  it('should echo command exist', (done) => {
    request(apis.sendMessage + '/echo').then((resp) => {

      expect(resp.ok).to.equal(true);
      expect(resp.result.message_id).to.be.an('number');
      expect(resp.result.text).to.equal('/echo');
      expect(resp.result.entities.pop().type).to.equal('bot_command');

      done();
    }).catch(done);
  });
});


describe('Test user\'s workflow', () => {
  let dictionary = low(new FileSync('dictionary.json')).getState();
  let db = low(new FileSync('db.json'));

  beforeEach(() => {
    db.defaults({ cvs: [] }).write();
  })

  it('should create request', (done) => {
    request(apis.sendMessage + 'test+initiate').then((resp) => {


      expect(resp.ok).to.equal(true);
      expect(resp.result.message_id).to.be.an('number');
      expect(resp.result.text).to.equal('test initiate');

      expect(db.get('cvs').find({ id: resp.result.chat.id }).value()).not.to.be.undefined();

      done();
    }).catch(done);
  });

  it('should accept main info', (done) => {
    return done();
    request(apis.sendMessage + dictionary.welcome).then((resp) => {

      console.log(resp.result);
      expect(resp.ok).to.equal(true);
      expect(resp.result.message_id).to.be.an('number');
      expect(resp.result.text).to.equal(dictionary.attachPhoto);

      done();
    }).catch(done);
  });

});
