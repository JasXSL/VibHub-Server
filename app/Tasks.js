// This is a library of websocket tasks you can use with VibHub

module.exports = {

	TASK_PWM : "p",							// (string)hex_pwm_bytes | Forward a hexadecimal PWM value update to one or more devices. The PWM bytes can begin with an extra byte of the bitwise value 0x1 to mark the values as high res (16 bit)
											// When sent to the server, the first byte is the device to send to. This byte is removed when forwarded to the device.
											// Received by: Server from App / Device from Server

	TASK_PWM_SPECIFIC : "ps",				// (string)hex_pwm_bytes | Similar to above, but ports are specified, hex bytes are in the order of: deviceIndex, port_id,pwm, port_id2,pwm2...
											// The leftmost bit (0x80) in deviceIndex is reserved as a "high res" flag. When set, you use 2 bytes for PWM where the leftmost is MSB. Ex: 00(devIdx) 80(port0,hiRes) 0FFF(max intensity for a 12bit device)  
											// Received by: Server from App / Device from Server

	TASK_VIB : "vib",						// Automatically sent by the server to a device when a REST program is received.
											// Received by: Device from Server
	
	TASK_ADD_DEVICE : "id",					// {id:(str)id, ...meta} OR (str)id | Adds a device to the server, allowing apps to send data to it.
											// Always pass an object with meta if you have the memory for it
											// See DeviceInfo.js in the server docs for the viable meta fields
											// Received by: Server from Device
	
	TASK_ADD_APP : "app",					// (str)name | Send from an app to add or update the app name. name is limited to 128 bytes 
											// If a device disconnects, you'll have to send this again to send the app name to the device.
											// This call is also automatically sent to any devices currently connected to the app, and also from TASK_HOOKUP / TASK_HOOKDOWN
											// When forwarded it gets the argument: [(str)appName, (str)appConnectionID]
											// Received by: Server from App, Device from Server

	TASK_WHOIS : "whois",					// (str)id | Gets meta information about a device
											// Received by: Server from App

	TASK_APP_OFFLINE : "app_offline",		// (str)appName, (str)connectionID | Automatically sent to all devices the app was connected to whenever the app goes offline.
											// Received by: Device from Server

	TASK_HOOKUP : "hookup",					// (str/arr)deviceIDs | Send from an app to hook up to a device and send PWM tasks
											// This also sends the TASK_ADD_APP command to the device(s)
											// Received by: Server from App

	TASK_HOOKDOWN : "hookdown",				// (str/arr)deviceName | Send from an app stop sending PWM tasks
											// Received by: Server from App

	TASK_DEVICE_ONLINE : "dev_online",		// (str)id, (str)socketID, (obj)meta | Automatically sent to all apps that have hooked up to a device whenever it comes online
											// Received by: App from Server
	
	TASK_DEVICE_OFFLINE : "dev_offline",	// (str)id, (str)socketID | Automatically sent to all apps that have hooked up to a device whenever it goes offline
											// Received by: App from Server

	TASK_CUSTOM_TO_DEVICE : "dCustom",		// (str)deviceID, (var)custom_data | Forwards custom data to an app connected to the device it's sent from by name
											// Received by the device on success: (str)appName, (str)socketID, (var)custom_data
											// Received by: Server from App, Device from Server

	TASK_CUSTOM_TO_APP : "aCustom",			// (str)socketID, (var)custom_data | Forwards custom data to a device connected to the app by app socketID. For this to work, the app must be named via TASK_ADD_APP
											// Received by the app on success: (str)deviceID, (str)socketID, (var)custom_data
											// Received by: Server from Device, App from Server

	TASK_GET : "GET",						// {id:(str)deviceID, type:(str)type, data:(obj)data} | Emulates a REST request with websocket. Uses the same structure.
											// Received by: Server from App

	TASK_BATTERY_REQ : "gb",				// {id:(str)deviceID/appID} | Requests battery status from a device. Note that devices have to have the TASK_BATTERY_STATUS capability in order to reply.
											// Received by: Server from App, Device from Server. DeviceID is replaced with appID on the server to designate the app to reply to.
	
	TASK_BATTERY_STATUS : "sb",				// {low:(bool)battery_is_low, mv:(int)millivolts, mx:(int)millivolts_max, app:(str)appID*, id:(str)deviceID*} | Requests/replies with battery status. If id is not supplied, it will reply to ALL apps.
											// Received by: App from Server (deviceID is supplied), Server from Device (if appID is specified, it replies to a specific app, provided the app has this device, otherwise it resplies to ALL apps that have this device).
	TASK_HIGHRES : "h",						// void | Not an endpoint, used to mark that we're able to use high resolution in vib/ps/p.
											// Received by: Server from Device. Capability data will be nr of bits supported.

};

