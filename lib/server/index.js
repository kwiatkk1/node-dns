const UDPServer = require('./udp-server');
const TCPServer = require('./tcp-server');

module.exports = {
  createServer: opts => new UDPServer(opts),
  createUDPServer: opts => new UDPServer(opts),
  createTCPServer: opts => new TCPServer()
};