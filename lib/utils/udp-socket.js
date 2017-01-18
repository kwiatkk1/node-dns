const dgram = require('dgram');
const { EventEmitter } = require('events');

class UDPSocket extends EventEmitter {
  constructor(socket, remote) {
    super();
    this._socket = socket;
    this._remote = remote;
    this._buff = undefined;
    this.base_size = 512;
    this.bound = false;
    this.unref = undefined;
    this.ref = undefined;
  }

  buffer(size) {
    this._buff = new Buffer(size);
    return this._buff;
  }

  send(len) {
    this._socket.send(this._buff, 0, len, this._remote.port, this._remote.address);
  }

  bind(type) {
    var self = this;

    if (this.bound) {
      this.emit('ready');
    } else {
      this._socket = dgram.createSocket(type);
      this._socket.on('listening', function() {
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

      this._socket.on('message', this.emit.bind(this, 'message'));

      this._socket.on('close', function() {
        self.bound = false;
        self.emit('close');
      });

      this._socket.bind({ exclusive: true });
    }
  }

  close() {
    this._socket.close();
  }

  remote(remote) {
    return new UDPSocket(this._socket, remote);
  }
}

module.exports = UDPSocket;
