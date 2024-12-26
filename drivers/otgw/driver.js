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
const MQTT = require('async-mqtt');
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

  async onPair(session) {
    let settings = null;
    let mqttClient = null;
    let discovered = [];

    session.setHandler('mqtt', async (mqttSettings) => {
      try {
        this.log(mqttSettings);
        // Check MQTT settings
        mqttClient = await this.connectMQTT(mqttSettings);
        settings = mqttSettings;

        // Discover OTGW gateway on MQTT broker
        const searchTopic = settings.topic === '' ? 'OTGW/value/+' : `${settings.topic}/value/+`;
        discovered = await this.discoverGateways(mqttClient, searchTopic);
        await mqttClient.end();
        if (discovered.length > 0) {
          this.log(discovered);
          await session.showView('list_devices');
          return Promise.resolve(discovered);
        }
        throw Error('MQTT Broker OK, but no OTGW found');
      } catch (error) {
        if (mqttClient) mqttClient.end();
        return Promise.reject(error);
      }
    });

    session.setHandler('list_devices', async () => {
      const devices = [];
      const baseTopic = settings.topic === '' ? 'OTGW/value/' : `${settings.topic}/value/`;
      discovered.forEach((gatewayUID) => {
        const id = gatewayUID;
        settings.uid = gatewayUID;
        settings.topic = baseTopic + gatewayUID;
        const device = {
          name: `OTGW ${id}`,
          data: {
            id, // `OTGW_${Math.random().toString(16).substring(2, 8)}`,
          },
          capabilities,
          settings,
        };
        devices.push(device);
      });
      return devices;
    });
  }

  // returns a connected MQTT client
  async connectMQTT(mqttSettings) {
    try {
      if (!mqttSettings) throw Error('mqttSettings are required');
      const protocol = mqttSettings.tls ? 'mqtts' : 'mqtt';
      const host = `${protocol}://${mqttSettings.host}:${mqttSettings.port}`;
      const options = {
        clientId: `Homey_${Math.random().toString(16).substring(2, 8)}`,
        username: mqttSettings.username,
        password: mqttSettings.password,
        // protocolId: 'MQTT',
        // protocolVersion: 4,
        rejectUnauthorized: false,
        keepalive: 60,
        reconnectPeriod: 10000,
        clean: true,
        queueQoSZero: false,
      };
      const mqttClient = await MQTT.connectAsync(host, options);
      return Promise.resolve(mqttClient);
    } catch (error) {
      this.error(error);
      return Promise.reject(error);
    }
  }

  // returns a list of OT gateways found on the MQTT broker
  async discoverGateways(mqttClient, searchTopic) {
    const gateways = [];
    const messageListener = (topic, message) => {
      this.log(`message received from topic: ${topic}`, message.toString());
      const gatewayUID = topic.split('/')[2]; // OTGW/value/otgw-A31F222A38AD > UID = otgw-A31F222A38AD
      if (gatewayUID && !gateways.includes(gatewayUID)) gateways.push(gatewayUID);
    };
    mqttClient.on('message', messageListener);
    await mqttClient.subscribe(searchTopic || 'OTGW/value/+');
    await setTimeoutPromise(5000); // wait 5 secs for discovery
    await mqttClient.unsubscribe(searchTopic || 'OTGW/value/+');
    await mqttClient.removeListener('message', messageListener);
    return Promise.all(gateways);
  }

}

module.exports = MyDriver;
