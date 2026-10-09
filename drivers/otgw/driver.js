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
const util = require('util');

const setTimeoutPromise = util.promisify(setTimeout);

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

  // 'dhw_block_onoff', // Is added on demand from device settings
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
    let mqttClient = null;
    let discovered = [];

    session.setHandler('mqtt', async (mqttSettings) => {
      try {
        this.log('MQTT settings', this.redact(mqttSettings));
        // Check MQTT settings
        mqttClient = await this.connectMQTT(mqttSettings);
        settings = mqttSettings;

        // Discover OTGW gateway on MQTT broker
        discovered = await this.discoverGateways(mqttClient, `${this.valueTopic(settings)}+`);
        await mqttClient.endAsync(true);
        if (discovered.length > 0) {
          this.log(discovered);
          await session.showView('list_devices');
          return Promise.resolve(discovered);
        }
        throw Error('MQTT Broker OK, but no OTGW found');
      } catch (error) {
        if (mqttClient) mqttClient.end(true);
        return Promise.reject(error);
      }
    });

    session.setHandler('list_devices', async () => {
      const valueTopic = this.valueTopic(settings);
      return discovered.map((uid) => ({
        name: `OTGW ${uid}`,
        data: { id: uid },
        capabilities,
        settings: { ...settings, uid, topic: valueTopic + uid },
      }));
    });
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
        reject(Error('No MQTT broker host configured'));
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
      timer = this.homey.setTimeout(() => finish(Error(`Connection to MQTT broker ${host} timed out`)), timeoutMs);
      client.once('connect', onConnect).once('error', finish);
    });
  }

  // returns a list of OT gateways found on the MQTT broker
  async discoverGateways(mqttClient, searchTopic) {
    const gateways = [];
    const messageListener = (topic, message) => {
      this.log(`message received from topic: ${topic}`, message.toString());
      const gatewayUID = topic.split('/').pop(); // <top topic>/value/otgw-A31F222A38AD > UID = otgw-A31F222A38AD
      if (gatewayUID && !gateways.includes(gatewayUID)) gateways.push(gatewayUID);
    };
    const errorListener = (error) => this.error(error);
    mqttClient.on('error', errorListener);
    mqttClient.on('message', messageListener);
    await mqttClient.subscribeAsync(searchTopic);
    await setTimeoutPromise(5000); // wait 5 secs for discovery
    await mqttClient.unsubscribeAsync(searchTopic);
    mqttClient.removeListener('message', messageListener);
    mqttClient.removeListener('error', errorListener);
    return gateways;
  }

}

module.exports = MyDriver;
