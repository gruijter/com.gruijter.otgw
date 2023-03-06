# com.gruijter.otgw

Manage and monitor your boiler via Homey, OpenTherm Gateway and MQTT.

There already was an app for OpenTherm GateWay, OTGW for short (many thanks for your work @nlrb !): https://homey.app/en-us/app/com.tclcode.otgw/OpenTherm-Gateway/
I tried to install it on my new Homey Pro 2023, but that was a no-go. Installing on my older Homey did work, but the connection was somewhat unstable, and the functionality was too heavy for my application.

**HP2023 and MQTT support**
I found out that OTGW can work with MQTT. So I spent my weekend and a bit more on writing a new OTGW app based on the MQTT interface. A good thing about MQTT is that it is a very stable method, and that the connection can be shared with other users like Home Assistant or Node-RED. Downside is: you need to have or setup an MQTT broker. But if you don't already have an MQTT broker, you can simply install one on Homey: https://homey.app/en-us/app/nl.scanno.mqttbroker/MQTT-Broker/

https://global.discourse-cdn.com/business4/uploads/athom/original/3X/d/4/d4a8e4d959e543a0a39b8103cdd9346f8e3e4127.jpeg

**OTGW: Central Heater management for control freaks.**
The OpenTherm Gateway is placed between your thermostat and your Central Heater.
It provides real time monitoring of many sensors and temperatures in your central heating system. It also allows you to control several advanced settings (USE AT OWN RISK!)

The OpenTherm GateWay is an open source device. It can be built by yourself, or purchased online. I bought it completely built with wifi adapter: https://www.nodo-shop.nl/
The firmware used to develop the Homey app was written by https://github.com/rvdbreemen .The firmware was already installed when I got the device. I had some trouble first time connecting to it from a Chrome browser. The solution was to use a FireFox browser in stead.

https://global.discourse-cdn.com/business4/uploads/athom/original/3X/a/d/ade2be00281a83ceb715c920d48b3751828dcb8c.jpeg

**Shower Timer Use Case**
About why I wanted to get an OTGW: I have built a fully automatic shower timer. If a family member showers longer then 8 minutes, lights start blinking. If the shower is still on after 10 minutes, lights out :rofl:
Yes, it is quite nerdy. But for myself and my wife it actually helps us very well to reduce our time spent under the shower. The teenage kids however keep showering in the dark forever.....

Now, with OTGW I get detailed information on the state of the Central Heater. For the shower timer I am most interested in DHW (Domestic Hot Water) flow and temperature. In theory I'm even capable of turning down the water temperature on a very long shower session. But I don't think I will implement that for now and keep the peace. :peace_symbol:

**Is it difficult to install and use OTGW?**
I don't mind this thread getting more technical, since OTGW is for the 'advanced control freaks' (at least, that is how I would categorize it). But let it also be clear that I wrote the Homey app for 'advanced' users, without any need to program anything. If you buy the device completely built, you only need to do some simple steps that *can be done by any lightly technical person*:
* Buy a completely built OTGW with WiFi and software installed: https://www.nodo-shop.nl/
* If you don’t have an MQTT broker, you can simply install one on Homey: [MQTT Broker App for Homey | Homey](https://homey.app/en-us/app/nl.scanno.mqttbroker/MQTT-Broker/)
* Put the OTGW board in its housing
* Place the OTGW between the existing Thermostat and Central Heater (= cut the existing wire coming out of the Central Heater)
* Power the OTGW unit and make a direct WiFi connection to it
* Configure OTGW access to your in-house WiFi (I had to use a FireFox browser)
* Reconnect the OTGW unit via your in-house WiFi
* Go to the OTGW settings page and enable connection to the MQTT  broker of your choice
* Install the Homey app and start adding OTGW as a device
* ALL DONE :slight_smile: 

I have published the app to Homey App store and hope that other users will find it useful as well!

Homey App Store (stable version): https://homey.app/en-us/app/com.gruijter.otgw
Homey App Store (test version): https://homey.app/en-us/app/com.gruijter.otgw/test

Donate: https://paypal.me/gruijter
