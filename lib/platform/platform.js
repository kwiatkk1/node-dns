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

const fs = require('fs');
const { EventEmitter } = require('events');
const net = require('net');
const os = require('os');
const util = require('util');
const path = require('path');
const Cache = require('native-dns-cache');
const { consts } = require('native-dns-packet');

const utils = require('../utils');

const { A, AAAA, PTR } = consts.NAME_TO_QTYPE;

class Platform extends EventEmitter {
  constructor() {
    super();

    this._nsReady = false;
    this._hostsReady = false;
    this._watches = {};

    this.hosts = new Cache();

    this._initNameServers();
    this._initHostsFile();
    this._populate();

    this.cache = false; //new Cache();
  }

  get ready() {
    return this._nsReady && this._hostsReady;
  }

  get watching() {
    return Object.keys(this._watches).length > 0;
  }

  set watching(value) {
    var k;
    if (value)
      this._watchFiles();
    else {
      for (k in this._watches) {
        this._watches[k].close();
        delete this._watches[k];
      }
    }
  }

  reload() {
    this.emit('unready');
    this._initNameServers();
    this._initHostsFile();
    this._populate();
  }

  _initNameServers() {
    this._nsReady = false;
    this.name_servers = [];
    this.search_path = [];
    this.timeout = 5 * 1000;
    this.attempts = 5;
    this.edns = false;
  }

  _initHostsFile() {
    this._hostsReady = false;
    this.hosts.purge();
  }

  _populate() {
    let hostsfile;

    switch (os.platform()) {
      case 'win32':
        this.name_servers = [
          {
            address: '8.8.8.8',
            port: 53
          },
          {
            address: '8.8.4.4',
            port: 53
          }
        ];
        this._nsReady = true;
        hostsfile = path.join(process.env.SystemRoot, 'System32', 'drivers', 'etc', 'hosts');
        break;
      default:
        this.parseResolv();
        hostsfile = '/etc/hosts';
        break;
    }

    this._parseHosts(hostsfile);
  }

  _watchFiles() {
    const watchParams = {persistent: false};

    switch (os.platform()) {
      case 'win32':
        //TODO XXX FIXME: it would be nice if this existed
        break;
      default:

        this._watches.resolve = fs.watch('/etc/resolv.conf', watchParams, (event, filename) => {
          if (event === 'change') {
            this.emit('unready');
            this._initNameServers();
            this.parseResolv();
          }
        });

        this._watches.hosts = fs.watch('/etc/hosts', watchParams, (event, filename) => {
          if (event === 'change') {
            this.emit('unready');
            this._initHostsFile();
            this._parseHosts('/etc/hosts');
          }
        });
        break;
    }
  }

  _checkReady() {
    if (this.ready) {
      this.emit('ready');
    }
  }

  parseResolv() {
    var self = this;

    fs.readFile('/etc/resolv.conf', 'ascii', function(err, file) {
      if (err) {
        // If the file wasn't found don't worry about it.
        if (err.code == 'ENOENT') {
          return;
        }
        throw err;
      }
      file.split(/\n/).forEach(function(line) {
        var i, parts, subparts;
        line = line.replace(/^\s+|\s+$/g, '');
        if (!line.match(/^#/)) {
          parts = line.split(/\s+/);
          switch (parts[0]) {
            case 'nameserver':
              self.name_servers.push({
                address: parts[1],
                port: 53
              });
              break;
            case 'domain':
              self.search_path = [parts[1]];
              break;
            case 'search':
              self.search_path = [parts.slice(1)];
              break;
            case 'options':
              for (i = 1; i < parts.length; i++) {
                subparts = parts[i].split(/:/);
                switch (subparts[0]) {
                  case 'timeout':
                    self.timeout = parseInt(subparts[1], 10) * 1000;
                    break;
                  case 'attempts':
                    self.attempts = parseInt(subparts[1], 10);
                    break;
                  case 'edns0':
                    self.edns = true;
                    break;
                }
              }
              break;
          }
        }
      });

      self._nsReady = true;
      self._checkReady();
    });
  }

  _parseHosts(hostsfile) {
    var self = this;

    fs.readFile(hostsfile, 'ascii', function(err, file) {
      var toStore = {};
      if (err) {
        throw err;
      }

      file.split(/\n/).forEach(function(line) {
        var i, parts, ip, revip, kind;
        line = line.replace(/^\s+|\s+$/g, '');
        if (!line.match(/^#/)) {
          parts = line.split(/\s+/);
          ip = parts[0];
          parts = parts.slice(1);
          kind = net.isIP(ip);

          if (parts.length && ip && kind) {
            /* IP -> Domain */
            revip = utils.reverseIP(ip);
            parts.forEach(function(domain) {
              var r = toStore[revip];
              if (!r)
                r = toStore[revip] = {};
              var t = r[PTR];
              if (!t)
                t = r[PTR] = [];
              t.push({
                type: PTR,
                class: 1,
                name: revip,
                data: domain,
                ttl: Infinity
              });
            });

            /* Domain -> IP */
            parts.forEach(function(domain) {
              var r = toStore[domain.toLowerCase()];
              if (!r) {
                r = toStore[domain.toLowerCase()] = {};
              }
              var type = kind === 4 ? A : AAAA;
              var t = r[type];
              if (!t)
                t = r[type] = [];
              t.push({
                type: type,
                name: domain.toLowerCase(),
                address: ip,
                ttl: Infinity
              });
            });
          }
        }
      });

      Object.keys(toStore).forEach(key => self.hosts._store.set(self.hosts._zone, key, toStore[key]));
      self._hostsReady = true;
      self._checkReady();
    });
  }
}

module.exports = Platform;
