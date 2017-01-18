// Copyright 2011 Timothy J Fontaine <tjfontaine@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE

const debug = require('debug')('nativedns:client');
const ipaddr = require('ipaddr.js');
const net = require('net');
const util = require('util');
const { EventEmitter } = require('events');
const { consts } = require('native-dns-packet');

const PendingRequests = require('./pending');
const Packet = require('./packet');
const utils = require('./utils');
const platform = require('./platform');

const { A, AAAA, MX, TXT, NS, CNAME, SRV, PTR, TLSA } = consts.NAME_TO_QTYPE;

const isString = object => typeof(object) === 'string' || object instanceof String;

class Server {
  constructor(opts = {}) {
    let { address, port = 53, type = 'udp' } = isString(opts) ? { address: opts } : opts;

    if (!address || !net.isIP(address))
      throw new Error('Server object must be supplied with at least address');

    if (['udp', 'tcp'].indexOf(type) === -1) {
      type = 'udp';
    }

    this.address = address;
    this.port = port;
    this.type = type;
  }
}

class Request extends EventEmitter {
  /**
   *
   * @param question
   * @param server
   * @param {number} [timeout]
   * @param {boolean} [try_edns]
   * @param {boolean} [cache]
   */
  constructor({ question, server, timeout = 4000, try_edns = false, cache = platform.cache }) {
    super();

    this.question = question;
    this.timeout = timeout;
    this.try_edns = try_edns;
    this.cache = cache;
    this.fired = false;
    this.id = undefined;
    this.server = new Server(server);

    debug('request created', this.question);
  }

  handle(err, answer, cached) {
    if (!this.fired) {
      debug('request handled', this.id, this.question);

      if (!cached && this.cache && this.cache.store && answer) {
        this.cache.store(answer);
      }

      this.emit('message', err, answer);
      this.done();
    }
  }

  done() {
    debug('request finished', this.id, this.question);
    this.fired = true;
    clearTimeout(this.timer_);
    PendingRequests.remove(this);
    this.emit('end');
    this.id = undefined;
  }

  handleTimeout() {
    if (!this.fired) {
      debug('request timedout', this.id, this.question);
      this.emit('timeout');
      this.done();
    }
  }

  error(err) {
    if (!this.fired) {
      debug('request error', err, this.id, this.question);
      this.emit('error', err);
      this.done();
    }
  }

  send() {
    debug('request starting', this.question);
    var self = this;

    if (this.cache && this.cache.lookup) {
      this.cache.lookup(this.question, function(results) {
        var packet;

        if (!results) {
          self._send();
        } else {
          packet = new Packet();
          packet.answer = results.slice();
          self.handle(null, packet, true);
        }
      });
    } else {
      this._send();
    }
  }

  _send() {
    debug('request not in cache', this.question);
    var self = this;

    this.timer_ = setTimeout(function() {
      self.handleTimeout();
    }, this.timeout);

    PendingRequests.send(self);
  }

  cancel() {
    debug('request cancelled', this.id, this.question);
    this.emit('cancelled');
    this.done();
  }
}

var _queue = [];

var sendQueued = function() {
  debug('platform ready sending queued requests');
  _queue.forEach(function(request) {
    request.start();
  });
  _queue = [];
};

platform.on('ready', function() {
  sendQueued();
});

if (platform.ready) {
  sendQueued();
}

class Resolve extends EventEmitter {
  constructor(opts, cb) {
    super();

    this.opts = util._extend({
      retryOnTruncate: true,
    }, opts);

    this._domain = opts.domain;
    this._rrtype = opts.rrtype;

    this._buildQuestion(this._domain);

    this._started = false;
    this._current_server = undefined;

    this._server_list = [];

    if (opts.remote) {
      this._server_list.push({
        address: opts.remote,
        port: 53,
        type: 'tcp',
      });
      this._server_list.push({
        address: opts.remote,
        port: 53,
        type: 'udp',
      });
    }

    this._request = undefined;
    this._type = 'getHostByName';
    this._cb = cb;

    if (!platform.ready) {
      _queue.push(this);
    } else {
      this.start();
    }
  }

  cancel() {
    if (this._request) {
      this._request.cancel();
    }
  }

  _buildQuestion(name) {
    debug('building question', name);
    this.question = {
      type: this._rrtype,
      class: consts.NAME_TO_QCLASS.IN,
      name: name
    };
  }

  _emit(err, answer) {
    debug('resolve end', this._domain);
    var self = this;
    process.nextTick(function() {
      if (err) {
        err.syscall = self._type;
      }
      self._cb(err, answer);
    });
  }

  _fillServers() {
    debug('resolve filling servers', this._domain);
    var tries = 0, s, t, u, slist;

    slist = platform.name_servers;

    if (slist.length === 0) {
      // No nameservers defined on platform, so this._server_list
      // stays empty.
      return;
    }

    while (this._server_list.length < platform.attempts) {
      s = slist[tries % slist.length];

      u = {
        address: s.address,
        port: s.port,
        type: 'udp'
      };

      t = {
        address: s.address,
        port: s.port,
        type: 'tcp'
      };

      this._server_list.push(u);
      this._server_list.push(t);

      tries += 1;
    }

    this._server_list.reverse();
  }

  _popServer() {
    debug('resolve pop server', this._current_server, this._domain);
    this._server_list.splice(0, 1, this._current_server);
  }

  _preStart() {
    if (!this._started) {
      this._started = new Date().getTime();
      this.try_edns = platform.edns;

      if (!this._server_list.length)
        this._fillServers();
    }
  }

  _shouldContinue() {
    debug('resolve should continue', this._server_list.length, this._domain);
    return this._server_list.length;
  }

  _nextQuestion() {
    debug('resolve next question', this._domain);
  }

  start() {
    if (!this._started) {
      this._preStart();
    }

    if (this._server_list.length === 0) {
      debug('resolve no more servers', this._domain);
      this._handleTimeout();
    } else {
      this._current_server = this._server_list.pop();
      debug('resolve start', this._current_server, this._domain);

      this._request = new Request({
        question: this.question,
        server: this._current_server,
        timeout: platform.timeout,
        try_edns: this.try_edns
      });

      this._request.on('timeout', this._handleTimeout.bind(this));
      this._request.on('message', this._handle.bind(this));
      this._request.on('error', this._handle.bind(this));

      this._request.send();
    }
  }

  _handle(err, answer) {
    const { NOERROR, SERVFAIL, NOTFOUND, FORMERR } = consts.NAME_TO_RCODE;

    var rcode, errno;

    if (answer) {
      rcode = answer.header.rcode;
    }

    debug('resolve handle', rcode, this._domain);

    switch (rcode) {
      case NOERROR:
        // answer trucated retry with tcp
        //console.log(answer);
        if (answer.header.tc &&
          this.opts.retryOnTruncate &&
          this._shouldContinue()) {
          debug('truncated', this._domain, answer);
          this.emit('truncated', err, answer);

          // remove udp servers
          this._server_list = this._server_list.filter(function(server) {
            return server.type === 'tcp';
          });
          answer = undefined;
        }
        break;
      case SERVFAIL:
        if (this._shouldContinue()) {
          this._nextQuestion();
          //this._popServer();
        } else {
          errno = consts.SERVFAIL;
        }
        answer = undefined;
        break;
      case NOTFOUND:
        if (this._shouldContinue()) {
          this._nextQuestion();
        } else {
          errno = consts.NOTFOUND;
        }
        answer = undefined;
        break;
      case FORMERR:
        if (this.try_edns) {
          this.try_edns = false;
          //this._popServer();
        } else {
          errno = consts.FORMERR;
        }
        answer = undefined;
        break;
      default:
        if (!err) {
          errno = consts.RCODE_TO_NAME[rcode];
          answer = undefined;
        } else {
          errno = consts.NOTFOUND;
        }
        break;
    }

    if (errno || answer) {
      if (errno) {
        err = new Error(this._type + ' ' + errno);
        err.errno = err.code = errno;
      }
      this._emit(err, answer);
    } else {
      this.start();
    }
  }

  _handleTimeout() {
    var err;

    if (this._server_list.length === 0) {
      debug('resolve timeout no more servers', this._domain);
      err = new Error(this._type + ' ' + consts.TIMEOUT);
      err.errno = consts.TIMEOUT;
      this._emit(err, undefined);
    } else {
      debug('resolve timeout continue', this._domain);
      this.start();
    }
  }
}

var resolve = function(domain, rrtype, ip, callback) {
  var res;

  if (!callback) {
    callback = ip;
    ip = undefined;
  }

  if (!callback) {
    callback = rrtype;
    rrtype = undefined;
  }

  rrtype = consts.NAME_TO_QTYPE[rrtype || 'A'];

  if (rrtype === PTR) {
    return reverse(domain, callback);
  }

  var opts = {
    domain: domain,
    rrtype: rrtype,
    remote: ip,
  };

  res = new Resolve(opts);

  res._cb = function(err, response) { debug('res', response);
    var ret = [], i, a;

    if (err) {
      callback(err, response);
      return;
    }

    for (i = 0; i < response.answer.length; i++) {
      a = response.answer[i];
      if (a.type === rrtype) {
        switch (rrtype) {
          case A:
          case AAAA:
            ret.push(a.address);
            break;
          case consts.NAME_TO_QTYPE.MX:
            ret.push({
              priority: a.priority,
              exchange: a.exchange
            });
            break;
          case TXT:
          case NS:
          case CNAME:
          case PTR:
            ret.push(a.data);
            break;
          case SRV:
            ret.push({
              priority: a.priority,
              weight: a.weight,
              port: a.port,
              name: a.target
            });
            break;
          default:
            ret.push(a);
            break;
        }
      }
    }

    if (ret.length === 0) {
      ret = undefined;
    }

    callback(err, ret);
  };

  return res;
};

const resolve4 = (domain, callback) => resolve(domain, 'A', callback);
const resolve6 = (domain, callback) => resolve(domain, 'AAAA', callback);
const resolveMx = (domain, callback) => resolve(domain, 'MX', callback);
const resolveTxt = (domain, callback) => resolve(domain, 'TXT', callback);
const resolveSrv = (domain, callback) => resolve(domain, 'SRV', callback);
const resolveNs = (domain, callback) => resolve(domain, 'NS', callback);
const resolveCname = (domain, callback) => resolve(domain, 'CNAME', callback);
const resolveTlsa = (domain, callback) => resolve(domain, 'TLSA', callback);

var reverse = function(ip, callback) {
  var error, opts, res;

  if (!net.isIP(ip)) {
    error = new Error('getHostByAddr ENOTIMP');
    error.errno = error.code = 'ENOTIMP';
    throw error;
  }

  opts = {
    domain: utils.reverseIP(ip),
    rrtype: PTR
  };

  res = new Lookup(opts);

  res._cb = function(err, response) {
    var results = [];

    if (response) {
      response.answer.forEach(function(a) {
        if (a.type === PTR) {
          results.push(a.data);
        }
      });
    }

    if (results.length === 0) {
      results = undefined;
    }

    callback(err, results);
  };

  return res;
};

class Lookup extends Resolve {
  constructor(opts) {
    super(opts);
    this._type = 'getaddrinfo';
  }

  start() {
    var self = this;

    if (!this._started) {
      this._search_path = platform.search_path.slice(0);
      this._preStart();
    }

    platform.hosts.lookup(this.question, function(results) {
      var packet;
      if (results && results.length) {
        debug('Lookup in hosts', results);
        packet = new Packet();
        packet.answer = results.slice();
        self._emit(null, packet);
      } else {
        debug('Lookup not in hosts');
        Resolve.prototype.start.call(self);
      }
    });
  }

  _shouldContinue() {
    debug('Lookup should continue', this._server_list.length,
      this._search_path.length);
    return this._server_list.length && this._search_path.length;
  }

  _nextQuestion() {
    debug('Lookup next question');
    this._buildQuestion([this._domain, this._search_path.pop()].join('.'));
  }
}

var lookup = function(domain, family, callback) {
  var rrtype, revip, res;

  if (!callback) {
    callback = family;
    family = undefined;
  }

  if (!family) {
    family = 4;
  }

  revip = net.isIP(domain);

  if (revip === 4 || revip === 6) {
    process.nextTick(function() {
      callback(null, domain, revip);
    });
    return {};
  }

  if (!domain) {
    process.nextTick(function() {
      callback(null, null, family);
    });
    return {};
  }

  rrtype = consts.FAMILY_TO_QTYPE[family];

  var opts = {
    domain: domain,
    rrtype: rrtype
  };

  res = new Lookup(opts);

  res._cb = function(err, response) {
    var i, afamily, address, a, all;

    if (err) {
      callback(err, undefined, undefined);
      return;
    }

    all = response.answer.concat(response.additional);

    for (i = 0; i < all.length; i++) {
      a = all[i];

      if (a.type === A || a.type === AAAA) {
        afamily = consts.QTYPE_TO_FAMILY[a.type];
        address = a.address;
        break;
      }
    }

    callback(err, address, afamily);
  };

  return res;
};

module.exports = {
  Request,
  Resolve,
  Lookup,
  resolve,
  reverse,
  lookup,

  resolve4,
  resolve6,
  resolveMx,
  resolveTxt,
  resolveSrv,
  resolveNs,
  resolveCname,
  resolveTlsa
};