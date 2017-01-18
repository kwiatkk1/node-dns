const net = require('net');

const Server = require('./server');
const { TCPSocket } = require('../utils');

class TCPServer extends Server {
  constructor() {
    const socket = net.createServer(client => {
      const tcp = new TCPSocket(client);
      const address = client.address();

      tcp.on('message', message => this.handleMessage(message, tcp, address));
      tcp.catchMessages();
    });

    super(socket);
  }

  serve(port, address, callback) {
    this._socket.listen(port, address, callback);
  }
}

module.exports = TCPServer;
