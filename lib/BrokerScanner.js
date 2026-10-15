/*
Copyright 2023 - 2026, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.otgw.

com.gruijter.otgw is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.otgw is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.otgw.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

const net = require('net');
const tls = require('tls');

// MQTT 3.1.1 CONNECT without credentials, clean session, keepalive 10s, client id "HomeyScan"
const CONNECT = Buffer.from([
  0x10, 21,
  0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x0a,
  0x00, 0x09, ...Buffer.from('HomeyScan'),
]);
const DISCONNECT = Buffer.from([0xe0, 0x00]);

// resolves { host, port, tls, auth } when an MQTT broker answers with a CONNACK, else null
function probe(host, port, useTls, timeoutMs) {
  return new Promise((resolve) => {
    const options = { host, port, timeout: timeoutMs };
    const socket = useTls
      ? tls.connect({ ...options, rejectUnauthorized: false })
      : net.connect(options);
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    // the socket idle timeout also runs while connecting
    socket.once('timeout', () => finish(null));
    socket.once(useTls ? 'secureConnect' : 'connect', () => socket.write(CONNECT));
    socket.once('data', (data) => {
      if (data.length < 4 || data[0] !== 0x20) {
        finish(null);
        return;
      }
      // return code 0 = accepted, 4 = bad username or password, 5 = not authorized
      const code = data[3];
      if (code === 0) socket.write(DISCONNECT);
      finish(code === 0 || code === 4 || code === 5 ? {
        host, port, tls: useTls, auth: code !== 0,
      } : null);
    });
    socket.once('error', () => finish(null));
    socket.once('close', () => finish(null));
  });
}

// scans the /24 of localIp on 1883 and 8883, all hosts in parallel
async function scan(localIp, timeoutMs = 1500) {
  const prefix = localIp.split('.').slice(0, 3).join('.');
  const probes = [];
  for (let i = 1; i < 255; i += 1) {
    const host = `${prefix}.${i}`;
    probes.push(probe(host, 1883, false, timeoutMs), probe(host, 8883, true, timeoutMs));
  }
  const found = (await Promise.all(probes)).filter(Boolean);
  return found.sort((a, b) => Number(a.host.split('.')[3]) - Number(b.host.split('.')[3]));
}

module.exports = { scan, probe };
