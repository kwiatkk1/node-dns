const dgram = require('dgram');

const Server = require('./server');
const { UDPSocket } = require('../utils');

class UDPServer extends Server {
  constructor({ dgram_type = 'udp4' } = {}) {
    const socket = dgram.createSocket(dgram_type)
      .on('message', (msg, remote) => this.handleMessage(msg, new UDPSocket(socket, remote), remote));

    super(socket);
  }

  serve(port, address, callback) {
    this._socket.bind(port, address, callback);
  }
}

module.exports = UDPServer;