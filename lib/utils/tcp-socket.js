const net = require('net');

const UDPSocket = require('./udp-socket');

class TCPSocket extends UDPSocket {
  constructor(socket) {
    super(socket);
    this.base_size = 4096;
    this._rest = undefined;
  }

  buffer(size) {
    this._buff = new Buffer(size + 2);
    return this._buff.slice(2);
  }

  send(len) {
    this._buff.writeUInt16BE(len, 0);
    this._socket.write(this._buff.slice(0, len + 2));
  }

  bind(server) {
    var self = this;

    if (this.bound) {
      this.emit('ready');
    } else {
      this._socket = net.connect(server.port, server.address);

      this._socket.on('connect', function() {
        self.bound = true;
        if (self._socket.unref) {
          self.unref = function() {
            self._socket.unref();
          }
          self.ref = function() {
            self._socket.ref();
          }
        }
        self.emit('ready');
      });

      this._socket.on('timeout', function() {
        self.bound = false;
        self.emit('close');
      });

      this._socket.on('close', function() {
        self.bound = false;
        self.emit('close');
      });

      this.catchMessages();
    }
  }

  catchMessages() {
    var self = this;
    this._socket.on('data', function(data) {
      var len, tmp;
      if (!self._rest) {
        self._rest = data;
      } else {
        tmp = new Buffer(self._rest.length + data.length);
        self._rest.copy(tmp, 0);
        data.copy(tmp, self._rest.length);
        self._rest = tmp;
      }
      while (self._rest && self._rest.length > 2) {
        len = self._rest.readUInt16BE(0);
        if (self._rest.length >= len + 2) {
          self.emit('message', self._rest.slice(2, len + 2), self);
          self._rest = self._rest.slice(len + 2);
        } else {
          break;
        }
      }
    });
  }

  close() {
    this._socket.end();
  }

  remote() {
    return this;
  }
}

module.exports = TCPSocket;
