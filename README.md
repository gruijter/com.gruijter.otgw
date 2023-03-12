# com.gruijter.otgw

Manage and monitor your boiler via Homey, OpenTherm Gateway and MQTT.

Homey App Store (stable version):
https://homey.app/en-us/app/com.gruijter.otgw

Homey App Store (test version): https://homey.app/en-us/app/com.gruijter.otgw/test

There already was an app for OpenTherm GateWay, OTGW for short (many thanks for your work @nlrb !): https://homey.app/en-us/app/com.tclcode.otgw/OpenTherm-Gateway/
I tried to install it on my new Homey Pro 2023, but that was a no-go. Installing on my older Homey did work, but the connection was somewhat unstable, and the functionality was too heavy for my application.

**HP2023 and MQTT support**

I found out that OTGW can work with MQTT. So I spent my weekend and a bit more on writing a new OTGW app based on the MQTT interface. A good thing about MQTT is that it is a very stable method, and that the connection can be shared with other users like Home Assistant or Node-RED. Downside is: you need to have or setup an MQTT broker. But if you don't already have an MQTT broker, you can simply install one on Homey: https://homey.app/en-us/app/nl.scanno.mqttbroker/MQTT-Broker/

<img src="https://global.discourse-cdn.com/business4/uploads/athom/original/3X/1/d/1deced71cc147a3a9a7b989a2b15f3c7ba0b6676.jpeg" width="40%" height="40%">

**OTGW: Central Heater management for control freaks.**

The OpenTherm Gateway is placed between your thermostat and your Central Heater.
It provides real time monitoring of many sensors and temperatures in your central heating system. It also allows you to control several advanced settings (USE AT OWN RISK!)

The OpenTherm GateWay is an open source device. It can be built by yourself, or purchased online. I bought it completely built with wifi adapter: https://www.nodo-shop.nl/
The firmware used to develop the Homey app was written by https://github.com/rvdbreemen .The firmware was already installed when I got the device.

![](https://global.discourse-cdn.com/business4/uploads/athom/optimized/3X/e/3/e3824d92c157828827caf42a4a5c1c22b6891fe3_2_225x500.jpeg)

![](https://global.discourse-cdn.com/business4/uploads/athom/optimized/3X/3/a/3a8dfa24c6df1d3a5cc2f6727ba0de2020646b0c_2_225x500.jpeg)

**Shower Timer Use Case**

About why I wanted to get an OTGW: I have built a fully automatic shower timer. If a family member showers longer then 8 minutes, lights start blinking. If the shower is still on after 10 minutes, lights out :rofl:
Yes, it is quite nerdy. But for myself and my wife it actually helps us very well to reduce our time spent under the shower. The teenage kids however keep showering in the dark forever.....

Now, with OTGW I get detailed information on the state of the Central Heater. For the shower timer I am most interested in DHW (Domestic Hot Water) flow and temperature. In theory I'm even capable of turning down the water temperature on a very long shower session. But I don't think I will implement that for now and keep the peace. :peace_symbol:

**Central Heating Tuning Use Case**

The second use case for me is fine tuning the Central Heater. By tuning the CH system I hope to save around 5% gas extra per year. The trick is to have the CH run in such a way that the boiler efficiency is improved, while not reducing comfort. Key for this is to reduce the temperature of the return water. A low return temperature of around 25 - 35 degrees improves the efficiency of modern boilers with a blazing 10%, when compared to a return temperature of 60 degrees: https://sdwaterland.nl/wordpress/wp-content/uploads/2016/11/grafiek_ketel_rendement.jpg
This is really for control freaks, and does require to go in-depth and read a lot online. For Dutch readers, this is a good source:
https://gathering.tweakers.net/forum/list_messages/2027810

**Is it difficult to install and use OTGW?**

I don't mind this thread getting more technical, since OTGW is for the 'advanced control freaks' (at least, that is how I would categorize it). But let it also be clear that the Homey app is not only for expert users or programmers. There is no need to program anything if you buy the device completely built. You only need to do some simple steps that *can be done by any person with only very basic technical knowhow*:
1) Buy a completely built OTGW with WiFi and software installed: https://www.nodo-shop.nl/
2) If you don’t have an MQTT broker, you can simply install one on Homey: [MQTT Broker App for Homey | Homey](https://homey.app/en-us/app/nl.scanno.mqttbroker/MQTT-Broker/)
3) Put the OTGW board in its housing
4) Place the OTGW between the existing Thermostat and Central Heater (= cut the existing wire coming out of the Central Heater)
5) Power the OTGW unit and make a direct WiFi connection to it
6) Configure OTGW access to your in-house WiFi (I had to use a FireFox browser)
7) Reconnect the OTGW unit via your in-house WiFi: http://otgw.local/
8) Go to the OTGW settings page and enable connection to the MQTT  broker of your choice
9) Install the Homey app and start adding OTGW as a device
10) ALL DONE :slight_smile: 

**Enjoy this Homey App!**

I have published the app to Homey App store and hope that other users will find it useful as well!

Donate: https://www.paypal.com/paypalme/gruijter
