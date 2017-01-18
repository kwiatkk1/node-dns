const { EventEmitter } = require('events');

const Packet = require('../packet');

class Server extends EventEmitter {
  constructor(socket) {
    super();

    this._socket = socket
      .on('listening', () => this.emit('listening'))
      .on('close', () => this.emit('close'))
      .on('error', (err)  => this.emit('socketError', err, socket));
  }

  close() {
    this._socket.close();
  }

  address() {
    return this._socket.address();
  }

  handleMessage(msg, remote, address) {
    let request;
    let response = new Packet(remote);

    try {
      request = Packet.parse(msg, remote);

      request.address = address;

      response.header.id = request.header.id;
      response.header.qr = 1;
      response.question = request.question;

      this.emit('request', request, response);
    } catch (e) {
      this.emit('error', e, msg, response);
    }
  }
}

module.exports = Server;
