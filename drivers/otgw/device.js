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

const { Device } = require('homey');
const util = require('util');
const DeviceMigrator = require('../../lib/DeviceMigrator');

const setTimeoutPromise = util.promisify(setTimeout);

// map a topic and its value to a capability or setting
const map = {
  // For capabilities
  '/Tboiler': (val) => ['measure_temperature.boiler', Number(val)], // 36.68
  '/TSet': (val) => ['target_temperature.boiler', Number(val)], // 57
  '/MaxTSet': (val) => ['target_temperature.boiler_max', Number(val)], // 57

  '/Tdhw': (val) => ['measure_temperature.dhw', Number(val)], // 35.31
  '/TdhwSet': (val) => ['target_temperature.dhw', Number(val)], // 57

  '/Tr': (val) => ['measure_temperature', Number(val)], // 19.4
  '/TrSet': (val) => ['target_temperature', Number(val)], // 20

  '/Tret': (val) => ['measure_temperature.return', Number(val)], // 30.41

  '/CHPressure': (val) => ['measure_pressure.ch', Number(val)], // 1.43
  '/DHWFlowRate': (val) => ['measure_water.dhw', Number(val)], // 2.52

  '/RelModLevel': (val) => ['meter_burner_modulation', Number(val)], // 19

  '/centralheating': (val) => ['ch_onoff', val === 'ON'], // OFF
  '/domestichotwater': (val) => ['dhw_onoff', val === 'ON'], // OFF
  '/dhw_blocking': (val) => ['dhw_block_onoff', val !== 'OFF'], // OFF
  '/flame': (val) => ['flame_onoff', val === 'ON'], // OFF

  '/BurnerStarts': (val) => ['meter_burner_starts', Number(val)], // 12567
  '/BurnerOperationHours': (val) => ['meter_burner_hours', Number(val)], // 2822
  '/DHWBurnerOperationHours': (val) => ['meter_burner_dhwhours', Number(val)], // 347

  '/fault': (val) => ['alarm_fault', val !== 'OFF'], // OFF
  '/': (val) => ['alarm_offline', val !== 'online'], // online / offline

  // For other purposes
  '/otgw-firmware/version': (val) => ['firmware_otgw', val], // 0.9.5+4eb7d24 (30-05-2022)
  '/otgw-pic/version': (val) => ['firmware_pic', val], // 6.4
};

class MyDevice extends Device {

  async onInit() {
    try {
      this.settings = await this.getSettings();
      this.gwValueTopic = this.settings.topic; // OTGW/value/otgw-A31F222A38AD
      this.gwSetTopic = this.settings.topic.replace('value', 'set'); // OTGW/set/otgw-A31F222A38AD

      await this.migrate();
      await this.connectOTGW();
      await this.registerListeners();

      this.restarting = false;
      await this.setAvailable();
      this.log('OTGW has been initialized');
    } catch (error) {
      this.error(error);
      this.restarting = false;
      await this.setUnavailable(error.message || 'MQTT is not connected').catch((err) => this.error(err));
      this.restartDevice(60 * 1000).catch(this.error);
    }
  }

  async migrate() {
    try {
      this.log(`checking device migration for ${this.getName()}`);
      const correctCaps = [...this.driver.ds.deviceCapabilities];
      if (this.settings.dhw_block_control) correctCaps.push('dhw_block_onoff');
      const rebuilt = await DeviceMigrator.migrateCapabilities(this, correctCaps, {
        unavailableMessage: 'Device is migrating. Please wait!',
      });

      // change to Thermostat or Other class
      const deviceClass = this.settings.class_thermostat ? 'thermostat' : 'other';
      if (this.getClass() !== deviceClass) {
        this.log(`changing class to ${deviceClass} for ${this.getName()}`);
        await this.setClass(deviceClass);
      }

      await DeviceMigrator.syncCapabilityOptions(this, {
        target_temperature: { step: this.settings.room_target_temp_step || 0.1 },
      }, { force: rebuilt });
    } catch (error) {
      this.error(error);
    }
  }

  onAdded() {
    this.log('Device added', this.getName());
  }

  async onSettings({ newSettings, changedKeys }) {
    this.log('Settings changed', changedKeys, newSettings);
    const mqttKeys = ['host', 'port', 'tls', 'username', 'password'];
    if (mqttKeys.some((key) => changedKeys.includes(key))) {
      try {
        const testClient = await this.driver.connectMQTT(newSettings);
        await testClient.endAsync(true);
      } catch (error) {
        throw Error(`Could not connect to MQTT broker: ${error.message || error}`);
      }
    }
    this.restartDevice(1000).catch((error) => this.error(error));
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async onDeleted() {
    await this.endClient();
    this.log('Device deleted', this.getName());
  }

  async onUninit() {
    await this.endClient();
    this.log('Device unInit', this.getName());
  }

  // detach before ending, so events of the old client no longer touch this device
  async endClient() {
    if (!this.client) return;
    const { client } = this;
    this.client = null;
    await client.endAsync(true).catch((error) => this.error(error));
  }

  async restartDevice(delay) {
    if (this.restarting) return;
    this.restarting = true;
    await this.endClient();
    const dly = delay || 1000 * 5;
    this.log(`Device will restart in ${dly / 1000} seconds`);
    // this.setUnavailable('Device is restarting');
    await setTimeoutPromise(dly);
    this.onInit().catch((error) => this.error(error));
  }

  setCapability(capability, value) {
    if (this.hasCapability(capability) && value !== undefined) {
      this.setCapabilityValue(capability, value)
        .catch((error) => {
          this.log(error, capability, value);
        });
    }
  }

  setSetting(setting, value) {
    this.settings = this.getSettings();
    if (this.settings && this.settings[setting] !== value) {
      const settings = {};
      settings[setting] = value;
      this.log('New setting:', settings);
      this.setSettings(settings)
        .catch((error) => {
          this.log(error, setting, value);
        });
    }
  }

  async sendCommand(command, source) {
    if (!this.client || !this.client.connected) return Promise.reject(Error('MQTT is not connected'));
    await this.client.publishAsync(`${this.gwSetTopic}/command`, command);
    this.log(`Command sent by ${source}: ${command}`);
    return Promise.resolve(true);
  }

  async setTargetTempRoom(temp, source) {
    if (!this.settings.room_target_temp_control) return Promise.reject(Error('Control is disabled from settings'));
    if (temp > this.settings.room_target_temp_max
      || temp < this.settings.room_target_temp_min) return Promise.reject(Error('Value is outside min/max settings'));
    if (!this.client || !this.client.connected) return Promise.reject(Error('MQTT is not connected'));
    await this.client.publishAsync(`${this.gwSetTopic}/command`, `TT=${temp}`);
    // await this.client.publishAsync(`${this.gwSetTopic}/setpoint`, `${temp}`).catch(this.log);
    this.log(`Room Target Temperature set by ${source} to ${temp}`);
    return Promise.resolve(true);
  }

  async setTargetTempBoiler(temp, source) {
    this.error('Trying to set the TargetTempBoiler');
    throw Error('Setting the Boiler Control Point is not possible.');
  }

  async setMaxTargetTempBoiler(temp, source) {
    if (!this.settings.boiler_target_temp_control) return Promise.reject(Error('Control is disabled from settings'));
    if (temp > this.settings.boiler_target_temp_max
      || temp < this.settings.boiler_target_temp_min) return Promise.reject(Error('Value is outside min/max settings'));
    if (!this.client || !this.client.connected) return Promise.reject(Error('MQTT is not connected'));
    await this.client.publishAsync(`${this.gwSetTopic}/command`, `SH=${temp}`);
    this.log(`Boiler Target Temperature set by ${source} to ${temp}`);
    return Promise.resolve(true);
  }

  async setTargetTempDhw(temp, source) {
    if (!this.settings.dhw_target_temp_control) return Promise.reject(Error('Control is disabled from settings'));
    if (temp > this.settings.dhw_target_temp_max
      || temp < this.settings.dhw_target_temp_min) return Promise.reject(Error('Value is outside min/max settings'));
    if (!this.client || !this.client.connected) return Promise.reject(Error('MQTT is not connected'));
    await this.client.publishAsync(`${this.gwSetTopic}/command`, `SW=${temp}`);
    this.log(`DHW Target Temperature set by ${source} to ${temp}`);
    return Promise.resolve(true);
  }

  async setDhwBlock(onoff, source) {
    if (!this.settings.dhw_block_control) return Promise.reject(Error('Control is disabled from settings'));
    if (!this.client || !this.client.connected) return Promise.reject(Error('MQTT is not connected'));
    await this.client.publishAsync(`${this.gwSetTopic}/command`, `BW=${1 * onoff}`);
    await this.client.publishAsync(`${this.gwSetTopic}/command`, `MW=${6 * onoff}`);
    this.log(`DHW blocking is set by ${source} to ${onoff}`);
    return Promise.resolve(true);
  }

  async connectOTGW() {
    try {
      if (!this.settings.host) throw Error('No MQTT server configured');
      await this.endClient();

      const handleMessage = async (topic, message) => {
        try {
          // console.log(`message received from topic: ${topic}`, message.toString());
          if (!topic.includes(this.gwValueTopic)) throw Error(topic, message);

          // Map the incoming value to a capability or setting
          let short = topic.replace(this.gwValueTopic, '');
          if (short === '') short = '/'; // OTGW online/offline
          const mapFunc = map[short];
          if (!mapFunc) return; // not included in Homey maping
          const capVal = mapFunc(message.toString());

          // OTGW device info update
          if (topic.includes('version')) {
            this.setSetting(capVal[0], capVal[1]);
            return;
          }
          // Capability update
          this.setCapability(capVal[0], capVal[1]);
        } catch (error) {
          this.error(error);
        }
      };

      const subscribeTopics = async () => {
        try {
          this.log(`Subscribing to ${this.gwValueTopic}/#`);
          await this.client.subscribeAsync([`${this.gwValueTopic}/#`]); // all values
          if (!this.restarting) await this.setAvailable();
          this.log('mqtt subscriptions ok');
        } catch (error) {
          this.error(error);
        }
      };

      this.log('connecting to MQTT', this.settings);
      const client = await this.driver.connectMQTT(this.settings);
      this.client = client;
      const isCurrent = () => this.client === client;
      // mqtt.js reconnects and resubscribes by itself, so connection events only reflect availability
      client
        .on('error', (error) => this.error(error))
        .on('offline', () => {
          this.log('mqtt broker is offline');
          if (isCurrent()) this.setUnavailable('MQTT broker is offline').catch(this.error);
        })
        .on('reconnect', () => this.log('mqtt is trying to reconnect'))
        .on('close', () => {
          this.log('mqtt closed (disconnected)');
          if (isCurrent()) this.setUnavailable('MQTT disconnected').catch(this.error);
        })
        .on('end', () => this.log('mqtt client ended'))
        .on('connect', () => {
          if (isCurrent()) subscribeTopics().catch(this.error);
        })
        .on('message', (topic, message) => {
          if (isCurrent()) handleMessage(topic, message).catch(this.error);
        });
      if (client.connected) await subscribeTopics();
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // register capability listeners
  registerListeners() {
    try {
      if (this.listenersSet) return true;
      this.log('registering listeners');

      // capabilityListeners will be overwritten, so no need to unregister them
      this.registerCapabilityListener('target_temperature', (temp) => this.setTargetTempRoom(temp, 'app'));
      this.registerCapabilityListener('target_temperature.dhw', (temp) => this.setTargetTempDhw(temp, 'app'));
      this.registerCapabilityListener('target_temperature.boiler', (temp) => this.setTargetTempBoiler(temp, 'app'));
      this.registerCapabilityListener('target_temperature.boiler_max', (temp) => this.setMaxTargetTempBoiler(temp, 'app'));
      this.registerCapabilityListener('dhw_block_onoff', (onoff) => this.setDhwBlock(onoff, 'app'));

      // this.registerMultipleCapabilityListener(['charge_target_slow', 'charge_target_fast'], async (values) => {
      //  const slow = Number(values.charge_target_slow) || Number(this.getCapabilityValue('charge_target_slow'));
      //  const fast = Number(values.charge_target_fast) || Number(this.getCapabilityValue('charge_target_fast'));
      //  const targets = { slow, fast };
      //  this.setChargeTargets(targets, 'app').catch(this.error);
      // }, 10000);

      this.listenersSet = true;
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

}

module.exports = MyDevice;
