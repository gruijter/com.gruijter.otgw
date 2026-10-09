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
const DeviceMigrator = require('../../lib/DeviceMigrator');

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
      this.settings = this.getSettings();
      this.gwValueTopic = this.settings.topic; // OTGW/value/otgw-A31F222A38AD
      this.gwSetTopic = this.settings.topic.replace(/\/value\/([^/]+)$/, '/set/$1'); // OTGW/set/otgw-A31F222A38AD

      await this.migrate();
      await this.connectOTGW();
      this.registerListeners();

      this.restarting = false;
      await this.setAvailable();
      this.log('OTGW has been initialized');
    } catch (error) {
      this.error(error);
      if (this.stopped) return;
      this.restarting = false;
      await this.setUnavailable(error.message || this.homey.__('errors.notConnected')).catch((err) => this.error(err));
      this.restartDevice(60 * 1000).catch(this.error);
    }
  }

  async migrate() {
    try {
      this.log(`checking device migration for ${this.getName()}`);
      const correctCaps = [...this.driver.ds.deviceCapabilities];
      if (this.settings.dhw_block_control) correctCaps.push('dhw_block_onoff');
      const rebuilt = await DeviceMigrator.migrateCapabilities(this, correctCaps);

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
    this.log('Settings changed', changedKeys, this.driver.redact(newSettings));
    const mqttKeys = ['host', 'port', 'tls', 'username', 'password'];
    if (mqttKeys.some((key) => changedKeys.includes(key))) {
      try {
        const testClient = await this.driver.connectMQTT(newSettings);
        await testClient.endAsync(true);
      } catch (error) {
        throw Error(this.homey.__('errors.connectFailed', { error: error.message || error }));
      }
    }
    this.restartDevice(1000).catch((error) => this.error(error));
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async onDeleted() {
    await this.stop();
    this.log('Device deleted', this.getName());
  }

  async onUninit() {
    await this.stop();
    this.log('Device unInit', this.getName());
  }

  // the instance is not used again after delete/uninit, so no restart may run after this
  async stop() {
    this.stopped = true;
    this.homey.clearTimeout(this.restartTimer);
    await this.endClient();
  }

  // detach before ending, so events of the old client no longer touch this device
  async endClient() {
    if (!this.client) return;
    const { client } = this;
    this.client = null;
    await client.endAsync(true).catch((error) => this.error(error));
  }

  async restartDevice(delay) {
    if (this.restarting || this.stopped) return;
    this.restarting = true;
    await this.endClient();
    const dly = delay || 1000 * 5;
    this.log(`Device will restart in ${dly / 1000} seconds`);
    this.restartTimer = this.homey.setTimeout(() => {
      this.onInit().catch((error) => this.error(error));
    }, dly);
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

  async publishCommand(command) {
    if (!this.client || !this.client.connected) throw Error(this.homey.__('errors.notConnected'));
    await this.client.publishAsync(`${this.gwSetTopic}/command`, command);
  }

  async sendCommand(command, source) {
    await this.publishCommand(command);
    this.log(`Command sent by ${source}: ${command}`);
    return true;
  }

  async setTargetTempRoom(temp, source) {
    if (!this.settings.room_target_temp_control) throw Error(this.homey.__('errors.controlDisabled'));
    if (temp > this.settings.room_target_temp_max
      || temp < this.settings.room_target_temp_min) throw Error(this.homey.__('errors.outOfRange'));
    await this.publishCommand(`TT=${temp}`);
    this.log(`Room Target Temperature set by ${source} to ${temp}`);
    return true;
  }

  async setTargetTempBoiler(temp, source) {
    this.error('Trying to set the TargetTempBoiler');
    throw Error(this.homey.__('errors.boilerSetpoint'));
  }

  async setMaxTargetTempBoiler(temp, source) {
    if (!this.settings.boiler_target_temp_control) throw Error(this.homey.__('errors.controlDisabled'));
    if (temp > this.settings.boiler_target_temp_max
      || temp < this.settings.boiler_target_temp_min) throw Error(this.homey.__('errors.outOfRange'));
    await this.publishCommand(`SH=${temp}`);
    this.log(`Boiler Target Temperature set by ${source} to ${temp}`);
    return true;
  }

  async setTargetTempDhw(temp, source) {
    if (!this.settings.dhw_target_temp_control) throw Error(this.homey.__('errors.controlDisabled'));
    if (temp > this.settings.dhw_target_temp_max
      || temp < this.settings.dhw_target_temp_min) throw Error(this.homey.__('errors.outOfRange'));
    await this.publishCommand(`SW=${temp}`);
    this.log(`DHW Target Temperature set by ${source} to ${temp}`);
    return true;
  }

  async setDhwBlock(onoff, source) {
    if (!this.settings.dhw_block_control) throw Error(this.homey.__('errors.controlDisabled'));
    await this.publishCommand(`BW=${1 * onoff}`);
    await this.publishCommand(`MW=${6 * onoff}`);
    this.log(`DHW blocking is set by ${source} to ${onoff}`);
    return true;
  }

  async connectOTGW() {
    if (!this.settings.host) throw Error(this.homey.__('errors.noHost'));
    await this.endClient();

    const handleMessage = (topic, message) => {
      try {
        if (!topic.includes(this.gwValueTopic)) throw Error(`Unexpected topic ${topic}`);

        // Map the incoming value to a capability or setting
        let short = topic.replace(this.gwValueTopic, '');
        if (short === '') short = '/'; // OTGW online/offline
        const mapFunc = map[short];
        if (!mapFunc) return; // not included in Homey mapping
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

    this.log('connecting to MQTT', this.driver.redact(this.settings));
    const client = await this.driver.connectMQTT(this.settings);
    if (this.stopped) {
      await client.endAsync(true).catch((error) => this.error(error));
      throw Error('Device was removed');
    }
    this.client = client;
    const isCurrent = () => this.client === client;
    // mqtt.js reconnects and resubscribes by itself, so connection events only reflect availability
    client
      .on('error', (error) => this.error(error))
      .on('offline', () => {
        this.log('mqtt broker is offline');
        if (isCurrent()) this.setUnavailable(this.homey.__('status.brokerOffline')).catch(this.error);
      })
      .on('reconnect', () => this.log('mqtt is trying to reconnect'))
      .on('close', () => {
        this.log('mqtt closed (disconnected)');
        if (isCurrent()) this.setUnavailable(this.homey.__('status.disconnected')).catch(this.error);
      })
      .on('end', () => this.log('mqtt client ended'))
      .on('connect', () => {
        if (isCurrent()) subscribeTopics().catch(this.error);
      })
      .on('message', (topic, message) => {
        if (isCurrent()) handleMessage(topic, message);
      });
    if (client.connected) await subscribeTopics();
  }

  // register capability listeners
  registerListeners() {
    if (this.listenersSet) return;
    this.log('registering listeners');

    // capabilityListeners will be overwritten, so no need to unregister them
    this.registerCapabilityListener('target_temperature', (temp) => this.setTargetTempRoom(temp, 'app'));
    this.registerCapabilityListener('target_temperature.dhw', (temp) => this.setTargetTempDhw(temp, 'app'));
    this.registerCapabilityListener('target_temperature.boiler', (temp) => this.setTargetTempBoiler(temp, 'app'));
    this.registerCapabilityListener('target_temperature.boiler_max', (temp) => this.setMaxTargetTempBoiler(temp, 'app'));
    this.registerCapabilityListener('dhw_block_onoff', (onoff) => this.setDhwBlock(onoff, 'app'));
    this.listenersSet = true;
  }

}

module.exports = MyDevice;
