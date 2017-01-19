const dns = require('../dns');

dns.resolve('www.google.com', function (err, results) {
  if (!err) {
    results.forEach(result => console.log('www.google.com', result));
  } else {
    console.log(err);
  }
});

dns.lookup('www.yahoo.com', function (err, family, result) {
  console.log('www.yahoo.com', family, result);
});

dns.resolveMx('microsoft.com', function (err, results) {
  results.forEach(function (result) {
    console.log(result);
  });
});

dns.resolveTxt('aol.com', function (err, results) {
  results.forEach(function (result) {
    console.log('aol.com txt:', result);
  });
});

dns.resolveSrv('_xmpp-server._tcp.gmail.com', function (err, results) {
  results.forEach(function (result) {
    console.log('google xmpp', result);
  });
});

dns.resolveNs('linode.com', function (err, results) {
  results.forEach(function (result) {
    console.log('linode ns', result);
  });
});

dns.resolveCname('www.allegrogroup.com', function (err, results) {
  results.forEach(function (result) {
    console.log('www.allegrogroup.com -->', result);
  });
});

dns.reverse('8.8.8.8', function (err, results) {
  results.forEach(function (result) {
    console.log('8.8.8.8 -->', result);
  });
});

dns.reverse('2600:3c03::f03c:91ff:fe96:48b', function (err, results) {
  results.forEach(function (result) {
    console.log('2600:3c03::f03c:91ff:fe96:48b -->', result);
  });
});

dns.resolve6('irc6.geo.oftc.net', function (err, results) {
  results.forEach(function (result) {
    console.log('irc6.geo.oftc.net', result);
  });
});

dns.resolve('www.linode.com', 'A', '8.8.8.8', function (err, results) {
  console.log("---- Direct Request ----");
  results.forEach(function (result) {
    console.log(result);
  });
  console.log("------------------------");
});
