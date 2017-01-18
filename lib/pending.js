// Copyright 2012 Timothy J Fontaine <tjfontaine@gmail.com>
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

'use strict';

const net = require('net');
const { UDPSocket, TCPSocket } = require('./utils');

const SocketQueue = require('./pending/socket-queue');

var serverHash = function(server) {
  if (server.type === 'tcp')
    return server.address + ':' + server.port;
  else
    return 'udp' + net.isIP(server.address);
};

var _sockets = {};

exports.send = function(request) {
  var hash = serverHash(request.server);
  var socket = _sockets[hash];

  if (!socket) {
    switch (hash) {
      case 'udp4':
      case 'udp6':
        socket = new SocketQueue(new UDPSocket(), hash);
        break;
      default:
        socket = new SocketQueue(new TCPSocket(), request.server);
        break;
    }

    socket.on('close', function() {
      delete _sockets[hash];
    });

    _sockets[hash] = socket;
  }

  socket.send(request);
};

exports.remove = function(request) {
  var hash = serverHash(request.server);
  var socket = _sockets[hash];
  if (socket) {
    socket.remove(request);
  }
};
