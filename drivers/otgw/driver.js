/*
Copyright 2023 - 2024, Robin de Gruijter (gruijter@hotmail.com)

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

const { Driver } = require('homey');
const mqtt = require('mqtt');
const net = require('net');
const util = require('util');
const BrokerScanner = require('../../lib/BrokerScanner');

const setTimeoutPromise = util.promisify(setTimeout);

// keep identical to the list in driver.compose.json
const capabilities = [
  'measure_temperature',
  'target_temperature',

  'measure_temperature.return',

  'target_temperature.boiler_max',

  'measure_temperature.boiler',
  'target_temperature.boiler',

  'measure_temperature.dhw',
  'target_temperature.dhw',

  'measure_water.dhw',
  'measure_pressure.ch',

  'ch_onoff',
  'dhw_onoff',
  'flame_onoff',
  'meter_burner_modulation',

  'meter_burner_starts',
  'meter_burner_hours',
  'meter_burner_dhwhours',
  'alarm_fault',
  'alarm_offline',

  // dhw_block_onoff is added on demand from device settings
];

class MyDriver extends Driver {

  async onInit() {
    this.ds = {
      deviceCapabilities: capabilities,
    };
    this.log('OTGW driver has been initialized');
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async onPair(session) {
    let settings = null;
    let discovered = [];
    // started right away, so the result is ready when the view asks for it
    const brokerScan = this.scanBrokers();

    session.setHandler('discover_brokers', () => brokerScan);

    session.setHandler('get_settings', () => null);

    session.setHandler('mqtt', async (mqttSettings) => {
      discovered = await this.findGateways(mqttSettings);
      settings = mqttSettings;
      await session.showView('list_devices');
      return discovered;
    });

    session.setHandler('list_devices', async () => {
      const valueTopic = this.valueTopic(settings);
      return discovered.map(({ uid, online }) => ({
        name: online ? `OTGW ${uid}` : `OTGW ${uid} (${this.homey.__('pair.offline')})`,
        data: { id: uid },
        capabilities,
        settings: { ...settings, uid, topic: valueTopic + uid },
      }));
    });
  }

  // links an existing device to another gateway, e.g. after the OTGW got a new board (new uid).
  // data.id cannot be changed by an app; the device only uses the uid and topic settings.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async onRepair(session, device) {
    this.log('Repairing of device started', device.getName());
    let settings = null;
    let discovered = [];
    const brokerScan = this.scanBrokers();

    session.setHandler('discover_brokers', () => brokerScan);

    session.setHandler('get_settings', () => {
      const {
        host, port, tls, username, password, topic,
      } = device.getSettings();
      return {
        host, port, tls, username, password, topic: (topic || '').replace(/\/value\/[^/]+$/, ''),
      };
    });

    session.setHandler('mqtt', async (mqttSettings) => {
      discovered = await this.findGateways(mqttSettings);
      settings = mqttSettings;
      await session.showView('select_gateway');
      return discovered;
    });

    session.setHandler('list_gateways', () => ({ gateways: discovered, current: device.getSettings().uid }));

    session.setHandler('select_gateway', async (uid) => {
      if (!settings || !discovered.some((gw) => gw.uid === uid)) throw Error(this.homey.__('errors.noGateway'));
      const newSettings = { ...settings, uid, topic: this.valueTopic(settings) + uid };
      this.log('new settings:', this.redact(newSettings));
      await device.setSettings(newSettings);
      device.restartDevice(1000).catch((error) => this.error(error));
      return true;
    });

    session.setHandler('disconnect', () => this.log('Repairing of device ended', device.getName()));
  }

  // gateways announced under <top topic>/value/ on the broker, rejects when there are none
  async findGateways(mqttSettings) {
    let mqttClient = null;
    try {
      this.log('MQTT settings', this.redact(mqttSettings));
      mqttClient = await this.connectMQTT(mqttSettings);
      const gateways = await this.discoverGateways(mqttClient, `${this.valueTopic(mqttSettings)}+`);
      await mqttClient.endAsync(true);
      this.log(gateways);
      if (gateways.length === 0) throw Error(this.homey.__('errors.noGateway'));
      return gateways;
    } catch (error) {
      if (mqttClient) mqttClient.end(true);
      throw error;
    }
  }

  // MQTT brokers on the /24 subnet of Homey, never rejects
  async scanBrokers() {
    try {
      const localIp = (await this.homey.cloud.getLocalAddress()).split(':')[0];
      if (!net.isIPv4(localIp)) {
        this.log(`no broker scan, local address ${localIp} is not IPv4`);
        return [];
      }
      const started = Date.now();
      const brokers = await BrokerScanner.scan(localIp);
      this.log(`broker scan of ${localIp}/24 took ${Date.now() - started} ms`, brokers);
      return brokers;
    } catch (error) {
      this.error(error);
      return [];
    }
  }

  // OTGW/value/ or <top topic>/value/
  valueTopic(mqttSettings) {
    const top = (mqttSettings.topic || '').trim().replace(/\/+$/, '') || 'OTGW';
    return `${top}/value/`;
  }

  // settings without the broker password, for logging
  redact(mqttSettings) {
    return { ...mqttSettings, password: mqttSettings.password ? '***' : '' };
  }

  // returns a connected MQTT client, or rejects on the first error or after timeoutMs
  connectMQTT(mqttSettings, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (!mqttSettings || !mqttSettings.host) {
        reject(Error(this.homey.__('errors.noHost')));
        return;
      }
      const protocol = mqttSettings.tls ? 'mqtts' : 'mqtt';
      const host = `${protocol}://${mqttSettings.host}:${mqttSettings.port}`;
      const options = {
        clientId: `Homey_${Math.random().toString(16).substring(2, 8)}`,
        username: mqttSettings.username,
        password: mqttSettings.password,
        rejectUnauthorized: false,
        keepalive: 60,
        reconnectPeriod: 10000,
        clean: true,
        queueQoSZero: false,
      };
      const client = mqtt.connect(host, options);
      let timer;
      let onConnect;
      const finish = (error) => {
        this.homey.clearTimeout(timer);
        client.off('connect', onConnect);
        client.off('error', finish);
        if (!error) {
          resolve(client);
          return;
        }
        client.end(true);
        this.error(error);
        reject(error);
      };
      onConnect = () => finish();
      timer = this.homey.setTimeout(() => finish(Error(this.homey.__('errors.timeout', { host }))), timeoutMs);
      client.once('connect', onConnect).once('error', finish);
    });
  }

  async discoverGateways(mqttClient, searchTopic) {
    const gateways = new Map();
    // <top topic>/value/<uid> holds the retained online/offline status
    const messageListener = (topic, message) => {
      this.log(`message received from topic: ${topic}`, message.toString());
      const uid = topic.split('/').pop();
      if (uid) gateways.set(uid, message.toString() !== 'offline');
    };
    const errorListener = (error) => this.error(error);
    mqttClient.on('error', errorListener);
    mqttClient.on('message', messageListener);
    await mqttClient.subscribeAsync(searchTopic);
    await setTimeoutPromise(1500); // the retained status messages arrive right after subscribing
    await mqttClient.unsubscribeAsync(searchTopic);
    mqttClient.removeListener('message', messageListener);
    mqttClient.removeListener('error', errorListener);
    return [...gateways].map(([uid, online]) => ({ uid, online }));
  }

}

module.exports = MyDriver;
