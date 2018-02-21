// This is a library of websocket tasks you can use with VibHub

module.exports = {

	TASK_PWM : "p",							// (string)hex_pwm_bytes | Forward a hexadecimal PWM value update to one or more devices
											// When sent to the server, the first byte is the device to send to, can you can also send an 8-bit arraybuffer instead of hex.
	
	TASK_VIB : "vib",						// Automatically sent by the server to a device when a REST program is received.
	
	TASK_ADD_DEVICE : "id",					// (str)id | Adds a device to the server, allowing apps to send data to it. id is limited to 128 bytes
	
	TASK_ADD_APP : "app",					// (str)name | Send from an app to add or update the app name. name is limited to 128 bytes 
											// If a device disconnects, you'll have to send this again to send the app name to the device.
											// This call is also automatically sent to any devices currently connected to the app, and also from TASK_HOOKUP / TASK_HOOKDOWN
	
	TASK_APP_OFFLINE : "app_offline",		// (str)appName, (str)connectionID | Automatically sent to all devices the app was connected to whenever the app goes offline.

	TASK_HOOKUP : "hookup",					// (str/arr)deviceName | Send from an app to hook up to a device and send PWM tasks
	TASK_HOOKDOWN : "hookdown",				// (str/arr)deviceName | Send from an app stop sending PWM tasks

	TASK_DEVICE_ONLINE : "dev_online",		// (str)id, (str)socketID | Automatically sent to all apps that have hooked up to a device whenever it comes online
	TASK_DEVICE_OFFLINE : "dev_offline",	// (str)id, (str)socketID | Automatically sent to all apps that have hooked up to a device whenever it goes offline


};

