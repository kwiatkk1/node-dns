const ipaddr = require('ipaddr.js');

function reverseIP(ip) {
  var address, kind, reverseip, parts;
  address = ipaddr.parse(ip.split(/%/)[0]);
  kind = address.kind();

  switch (kind) {
    case 'ipv4':
      address = address.toByteArray();
      address.reverse();
      reverseip = address.join('.') + '.IN-ADDR.ARPA';
      break;
    case 'ipv6':
      parts = [];
      address.toNormalizedString().split(':').forEach(function(part) {
        var i, pad = 4 - part.length;
        for (i = 0; i < pad; i++) {
          part = '0' + part;
        }
        part.split('').forEach(function(p) {
          parts.push(p);
        });
      });
      parts.reverse();
      reverseip = parts.join('.') + '.IP6.ARPA';
      break;
  }

  return reverseip;
}

module.exports = reverseIP;
