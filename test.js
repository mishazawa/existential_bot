const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const requestPromise = require('request-promise');
const { expect } = require('chai');
require('dotenv').config();

function request(uri, formData = {}) {
  return requestPromise({
    uri,
    formData,
    json: true,
  });
}
const apiBaseUrl = `https://api.telegram.org/bot${process.env.TOKEN}`;

const apis = {
  getMe: `${apiBaseUrl}/getMe`,
  sendMessage: `${apiBaseUrl}/sendMessage?chat_id=${process.env.CHAT}&text=`,
  /*
   * Media is a file id on TG server, or url from internet.
   * "attach://<file_attach_name>" to upload a new one using 
   * multipart/form-data under <file_attach_name> name
   */
  inputPhoto: `${apiBaseUrl}/InputMediaPhoto?type=photo&media=`
}

describe('Image upload test', () => {
  it('should upload a new photo', (done) => {
    request(apis.inputPhoto, { attachments: [`attach://${__dirname + "/DSC02300.jpg"}`] })
      .then(resp => {
        expect(resp.ok).to.equal(true);
        done();
      }).catch(done);
  });
  
  it('should fail to upload an existing photo on TG servers', (done) => {
    request(apis.inputPhoto + 'id4234324').then(resp => {
        expect(resp.ok).to.equal(false);
        done();
    }).catch(done);
  });

  it('should upload a photo from url', (done) => {
    request(apis.inputPhoto + 'https://www.rca.ac.uk/media/images/2_30.focus-none.width-400.jpg')
      .then(resp => {
        expect(resp.ok).to.equal(true);
        done();
      }).catch(done);
  });
})
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
