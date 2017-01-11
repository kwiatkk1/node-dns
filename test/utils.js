var childProcess = require('child_process');

exports.exclusiveSocketsInClusterMode = function (test) {

  function clusterModeTest() {
    var cluster = require('cluster');
    var utils = require('./lib/utils');

    if (cluster.isMaster) {
      var workerSocketsPorts = [];

      cluster.on('message', function (worker, message) {
        if (message.port) {
          workerSocketsPorts.push(message.port);
          if (workerSocketsPorts.length === 2) {
            process.exit(workerSocketsPorts[0] === workerSocketsPorts[1] ? -1 : 0);
          }
        }
      });

      cluster.fork();
      cluster.fork();
    } else {
      var udpSocket = new utils.UDPSocket();

      udpSocket
        .on('ready', function () { process.send({ port: udpSocket._socket.address().port }); })
        .bind('udp4');
    }
  }

  var inlineScript = ('"(' + clusterModeTest.toString().replace(/\n/g, '') + ').call();"');

  childProcess.exec('node -e ' + inlineScript, function (err) {
    test.ifError(err, 'Should not share the same socket port');
    test.done();
  });
};