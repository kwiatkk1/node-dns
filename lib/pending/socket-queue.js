const debug = require('debug')('nativedns:pending');
const net = require('net');
const util = require('util');
const { EventEmitter } = require('events');
const Packet = require('../packet');
const consts = require('native-dns-packet').consts;

const random_integer = () =>  Math.floor(Math.random() * 50000 + 1);

class SocketQueue extends EventEmitter {
  constructor(socket, server) {
    super();

    this._active = {};
    this._active_count = 0;
    this._pending = [];

    debug('created', server);

    this._server = server;

    this._socket = socket;
    this._socket.on('ready', this._onlisten.bind(this));
    this._socket.on('message', this._onmessage.bind(this));
    this._socket.on('close', this._onclose.bind(this));
    this._socket.bind(server);

    this._refd = true;
  }
  send(request) {
    debug('added', request.question);
    this._pending.push(request);
    this._fill();
  }

  remove(request) {
    var req = this._active[request.id];
    var idx = this._pending.indexOf(request);

    if (req) {
      delete this._active[request.id];
      this._active_count -= 1;
      this._fill();
    }

    if (idx > -1)
      this._pending.splice(idx, 1);

    this._unref();
  }

  close() {
    debug('closing', this._server);
    this._socket.close();
    this._socket = undefined;
    this.emit('close');
  }

  _fill() {
    debug('pre fill, active:', this._active_count, 'pending:', this._pending.length);

    while (this._listening && this._pending.length && this._active_count < 100) {
      this._dequeue();
    }

    debug('post fill, active:', this._active_count, 'pending:', this._pending.length);
  }

  _dequeue() {
    var req = this._pending.pop();
    var id, packet, dnssocket;

    if (req) {
      id = random_integer();

      while (this._active[id])
        id = random_integer();

      debug('sending', req.question, id);

      req.id = id;
      this._active[id] = req;
      this._active_count += 1;

      try {
        packet = new Packet(this._socket.remote(req.server));
        packet.header.id = id;
        packet.header.rd = 1;

        if (req.try_edns) {
          packet.edns_version = 0;
          //TODO when we support dnssec
          //packet.do = 1
        }

        packet.question.push(req.question);
        packet.send();

        this._ref();
      } catch (e) {
        req.error(e);
      }
    }
  }

  _onmessage(msg, remote) {
    var req, packet;

    debug('got a message', this._server);

    try {
      packet = Packet.parse(msg, remote);
      req = this._active[packet.header.id];
      debug('associated message', packet.header.id);
    } catch (e) {
      debug('error parsing packet', e);
    }

    if (req) {
      delete this._active[packet.header.id];
      this._active_count -= 1;
      req.handle(null, packet);
      this._fill();
    }

    this._unref();
  }

  _unref() {
    var self = this;
    this._refd = false;

    if (this._active_count <= 0) {
      if (this._socket.unref) {
        debug('unrefd socket');
        this._socket.unref();
      } else if (!this._timer) {
        this._timer = setTimeout(function() {
          self.close();
        }, 300);
      }
    }
  }

  _ref() {
    this._refd = true;
    if (this._socket.ref) {
      debug('refd socket');
      this._socket.ref();
    } else if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _onlisten() {
    this._unref();
    this._listening = true;
    this._fill();
  }

  _onclose() {
    var req, err;

    debug('socket closed', this);

    this._listening = false;

    err = new Error('getHostByName ' + consts.TIMEOUT);
    err.errno = consts.TIMEOUT;

    while (this._pending.length) {
      req = this._pending.pop();
      req.error(err);
    }

    Object.keys(this._active).forEach(key => {
      var req = this._active[key];
      req.error(err);
      delete this._active[key];
      this._active_count -= 1;
    });
  }
}

module.exports = SocketQueue;
