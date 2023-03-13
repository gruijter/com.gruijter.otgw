/* eslint-disable no-await-in-loop */
/*
Copyright 2023, Robin de Gruijter (gruijter@hotmail.com)

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

const setTimeoutPromise = util.promisify(setTimeout);

// map a topic and its value to a capability or setting
const map = {
	// For capabilities
	'/Tboiler': (val) => ['measure_temperature.boiler', Number(val)], // 36.68
	'/TSet': (val) => ['target_temperature.boiler', Number(val)], // 57
	'/MaxTSet': (val) => ['target_temperature.boiler_max', Number(val)], // 57

	'/Tdhw': (val) => ['measure_temperature.dhw', Number(val)], // 35.31
	'/TdhwSet': (val) => ['target_temperature.dhw', Number(val)], // 57

	'/Tr': (val) => ['measure_temperature.room', Number(val)], // 19.4
	'/TrSet': (val) => ['target_temperature.room', Number(val)], // 20

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
			this.gwValueTopic = this.settings.topic;	// OTGW/value/otgw-A31F222A38AD
			this.gwSetTopic = this.settings.topic.replace('value', 'set'); // OTGW/set/otgw-A31F222A38AD

			await this.migrate();
			await this.connectOTGW();
			await this.registerListeners();

			this.restarting = false;
			this.setAvailable();
			this.log('OTGW has been initialized');
		} catch (error) {
			this.error(error);
			this.restartDevice(60 * 1000).catch(this.error);
		}
	}

	async migrate() {
		try {
			this.log(`checking device migration for ${this.getName()}`);

			// store the capability states before migration
			const sym = Object.getOwnPropertySymbols(this).find((s) => String(s) === 'Symbol(state)');
			const state = this[sym];
			// check and repair incorrect capability(order)
			const correctCaps = this.driver.ds.deviceCapabilities;
			for (let index = 0; index < correctCaps.length; index += 1) {
				const caps = this.getCapabilities();
				const newCap = correctCaps[index];
				if (caps[index] !== newCap) {
					this.setUnavailable('Device is migrating. Please wait!');
					// remove all caps from here
					for (let i = index; i < caps.length; i += 1) {
						this.log(`removing capability ${caps[i]} for ${this.getName()}`);
						await this.removeCapability(caps[i])
							.catch((error) => this.log(error));
						await setTimeoutPromise(2 * 1000); // wait a bit for Homey to settle
					}
					// add the new cap
					this.log(`adding capability ${newCap} for ${this.getName()}`);
					await this.addCapability(newCap);
					// restore capability state
					if (state[newCap]) this.log(`${this.getName()} restoring value ${newCap} to ${state[newCap]}`);
					// else this.log(`${this.getName()} has gotten a new capability ${newCap}!`);
					if (state[newCap] !== undefined) this.setCapability(newCap, state[newCap]);
					await setTimeoutPromise(2 * 1000); // wait a bit for Homey to settle
				}
			}

			// add optional DHW_block onoff
			if (this.settings.dhw_block_control !== this.getCapabilities().includes('dhw_block_onoff')) {
				if (this.settings.dhw_block_control) {
					this.log(`adding capability dhw_block_onoff for ${this.getName()}`);
					await this.addCapability('dhw_block_onoff');
				} else {
					this.log(`removing capability dhw_block_onoff for ${this.getName()}`);
					await this.removeCapability('dhw_block_onoff').catch((error) => this.log(error));
				}
				await setTimeoutPromise(2 * 1000); // wait a bit for Homey to settle
			}
		} catch (error) {
			this.error(error);
		}
	}

	async onAdded() {
		this.log('Device added', this.getName());
	}

	async onSettings({ newSettings }) { 	// oldSettings changedKeys
		this.log('Settings changed', newSettings);
		this.restartDevice(1000);
	}

	async onDeleted() {
		if (this.client) await this.client.end();
		this.log('Device deleted', this.getName());
	}

	async onUninit() {
		if (this.client) await this.client.end();
		this.log('Device unInit', this.getName());
	}

	async restartDevice(delay) {
		// this.destroyListeners();
		if (this.restarting) return;
		this.restarting = true;
		if (this.client) await this.client.end();
		const dly = delay || 1000 * 5;
		this.log(`Device will restart in ${dly / 1000} seconds`);
		// this.setUnavailable('Device is restarting');
		await setTimeoutPromise(dly);
		this.onInit();
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
		if (this.settings && this.settings[setting] !== value) {
			const settings = {};
			settings[setting] = value;
			this.log('New setting:', settings);
			this.setSettings(settings, value)
				.catch((error) => {
					this.log(error, setting, value);
				});
		}
	}

	async sendCommand(command, source) {
		if (!this.client || !this.client.connected) return Promise.reject(Error('MQTT is not connected'));
		await this.client.publish(`${this.gwSetTopic}/command`, command);
		this.log(`Command sent by ${source}: ${command}`);
		return Promise.resolve(true);
	}

	async setTargetTempRoom(temp, source) {
		if (!this.settings.room_target_temp_control) return Promise.reject(Error('Control is disabled from settings'));
		if (temp > this.settings.room_target_temp_max
			|| temp < this.settings.room_target_temp_min) return Promise.reject(Error('Value is outside min/max settings'));
		if (!this.client || !this.client.connected) return Promise.reject(Error('MQTT is not connected'));
		await this.client.publish(`${this.gwSetTopic}/command`, `TT=${temp}`);
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
		await this.client.publish(`${this.gwSetTopic}/command`, `SH=${temp}`);
		this.log(`Boiler Target Temperature set by ${source} to ${temp}`);
		return Promise.resolve(true);
	}

	async setTargetTempDhw(temp, source) {
		if (!this.settings.dhw_target_temp_control) return Promise.reject(Error('Control is disabled from settings'));
		if (temp > this.settings.dhw_target_temp_max
			|| temp < this.settings.dhw_target_temp_min) return Promise.reject(Error('Value is outside min/max settings'));
		if (!this.client || !this.client.connected) return Promise.reject(Error('MQTT is not connected'));
		await this.client.publish(`${this.gwSetTopic}/command`, `SW=${temp}`);
		this.log(`DHW Target Temperature set by ${source} to ${temp}`);
		return Promise.resolve(true);
	}

	async setDhwBlock(onoff, source) {
		if (!this.settings.dhw_block_control) return Promise.reject(Error('Control is disabled from settings'));
		if (!this.client || !this.client.connected) return Promise.reject(Error('MQTT is not connected'));
		await this.client.publish(`${this.gwSetTopic}/command`, `BW=${1 * onoff}`);
		await this.client.publish(`${this.gwSetTopic}/command`, `MW=${6 * onoff}`);
		this.log(`DHW blocking is set by ${source} to ${onoff}`);
		return Promise.resolve(true);
	}

	async connectOTGW() {
		try {
			if (!this.settings.host) throw Error('No MQTT server configured');
			if (this.client) await this.client.end();

			const handleMessage = async (topic, message) => {
				try {
					// console.log(`message received from topic: ${topic}`, message.toString());
					if (!topic.includes(this.gwValueTopic)) throw Error(topic, message);

					// Map the incoming value to a capability or setting
					let short = topic.replace(this.gwValueTopic, '');
					if (short === '') short = '/'; // OTGW online/offline
					const mapFunc = map[short];
					if (!mapFunc) return;	// not included in Homey maping
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
					await this.client.subscribe([`${this.gwValueTopic}/#`]); // all values
					this.log('mqtt subscriptions ok');
				} catch (error) {
					this.error(error);
				}
			};

			this.log('connecting to MQTT', this.settings);
			this.client = await this.driver.connectMQTT(this.settings);
			this.client
				.on('error', (error) => { this.error(error); })
				.on('offline', () => { this.log('mqtt broker is offline'); })
				.on('reconnect', () => { this.log('mqtt is trying to reconnect'); })
				.on('close', () => { this.log('mqtt closed (disconnected)');	})
				.on('end', () => { this.log('mqtt client ended'); })
				.on('connect', subscribeTopics)
				.on('message', handleMessage);
			if (this.client.connected) subscribeTopics();
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
			this.registerCapabilityListener('target_temperature.room', (temp) => this.setTargetTempRoom(temp, 'app'));
			this.registerCapabilityListener('target_temperature.dhw', (temp) => this.setTargetTempDhw(temp, 'app'));
			this.registerCapabilityListener('target_temperature.boiler', (temp) => this.setTargetTempBoiler(temp, 'app'));
			this.registerCapabilityListener('target_temperature.boiler_max', (temp) => this.setMaxTargetTempBoiler(temp, 'app'));
			this.registerCapabilityListener('dhw_block_onoff', (onoff) => this.setDhwBlock(onoff, 'app'));

			// this.registerMultipleCapabilityListener(['charge_target_slow', 'charge_target_fast'], async (values) => {
			// 	const slow = Number(values.charge_target_slow) || Number(this.getCapabilityValue('charge_target_slow'));
			// 	const fast = Number(values.charge_target_fast) || Number(this.getCapabilityValue('charge_target_fast'));
			// 	const targets = { slow, fast };
			// 	this.setChargeTargets(targets, 'app').catch(this.error);
			// }, 10000);

			this.listenersSet = true;
			return Promise.resolve(true);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}

module.exports = MyDevice;
