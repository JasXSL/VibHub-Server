const
	express = require("express"),
	app = express(),
	http = require("http").Server(app),
	io = require("socket.io")(http),
	TASKS = require("./Tasks"),
	fs = require('fs')
;

class Server{

	constructor( config ){
	
		let th = this;

		// Server base configuration
		this.config = {
			port : 6969,
			debug : false
		};

		this.loadConfig()
		.then(() => {

			// Begin
			th.allowDebug = th.config.debug;
			th.port = +th.config.port;
			
			// Start HTTP listening
			http.listen(th.port, () => {
				console.log("Server online", th.port);
			});

			app.use(express.static(__dirname+'/public'));
		
			// Handle http requests
			app.get('/api', (req, res) => { th.onGet(req, res); });

			// Handle WS requests
			io.on("connection", socket => {

				th.debug("sIO New generic connection established");

				socket.on("disconnect", () => { th.onDisconnect(socket); });
				socket.on(TASKS.TASK_ADD_DEVICE, id => { th.onDeviceConnected(socket, id); });
				socket.on(TASKS.TASK_HOOKUP, (id, res) => { th.onAppHookup(socket, id, res); });
				socket.on(TASKS.TASK_HOOKDOWN, (id, res) => { th.onAppHookdown(socket, id, res); });
				socket.on(TASKS.TASK_PWM, buffer => { th.onSocketPWM(socket, buffer); });
				socket.on(TASKS.TASK_ADD_APP, (name, res) => { th.onAppName(socket, name, res); });
				socket.on(TASKS.TASK_CUSTOM_TO_DEVICE, (data) => { th.onCustomToDevice(socket, data); });
				socket.on(TASKS.TASK_CUSTOM_TO_APP, (data) => { th.onCustomToApp(socket, data); });

			});


		})
		.catch(err => {
			console.error("Unable to load config, using default. Error: ", err);
		});


	}


	loadConfig(){

		let th = this;
		// Get config
		return new Promise( (res, rej) => {

			fs.readFile(__dirname+'/config.json', 'utf8', (err, data) => {
				
				if( err )
					return rej("Unable to read config, using defaults: "+err.code);
					
				try{
	
					let json = JSON.parse(data);
					if( typeof json !== "object" )
						return rej('Config is not an object');
	
					else{
	
						for( let i in json ){
	
							if( th.config.hasOwnProperty(i) ){
	
								if( typeof th.config[i] === typeof json[i] )
									th.config[i] = json[i];
								else
									console.log("Invalid type of config", i, "got", typeof json[i], "expected", typeof th.config[i]);
	
							}
							else
								console.log("Unknown config property", i);
	
						}
	
					}
	
				}catch(e){
					rej(e);
				}
				
				res();
	
			});

		});
		
	}


	// CONNECTIONS
	onDisconnect( socket ){

		this.debug("Client disconnected");

		// Let any connected apps know that a device was disconnected
		this.sendToAppsByDeviceSocket(socket, TASKS.TASK_DEVICE_OFFLINE, [
			socket._device_id,
			socket.id
		]);
		
		// Let any connected devices know that an app was disconnected
		this.sendToDevicesByAppSocket(socket, TASKS.TASK_APP_OFFLINE, [
			socket._app_name || '',
			socket.id
		]);

	}

	// Enables a device for listening
	onDeviceConnected( socket, id ){

		if( typeof id !== 'string' )
			return this.debug("Invalid ID for room join");

		id = id.substr(0,128);

		socket.leaveAll();
		socket.join(Server.deviceSelfRoom(id));
		socket._device_id = id;

		// Tell any apps subscribed to this id that a device has come online
		this.sendToAppsByDeviceSocket(socket, TASKS.TASK_DEVICE_ONLINE, [id, socket.id]);
		this.debug("device", id, "is now listening");

		Server.getAppsControllingDevice(socket)
		.catch(err => {console.error("Unable to get apps controlling device", err);})
		.then(apps => {

			console.log("Apps in my room: ", apps.length);
			for( let app of apps )
				this.sendToSocket(socket, TASKS.TASK_ADD_APP, [app._app_name || '', app.id]);

		});
		
	}

	// Adds one or more devices from an app connection
	onAppHookup( socket, ids, res ){
		
		if( !Array.isArray(ids) )
			ids = [ids];

		if( !Array.isArray(socket._devices) )
			socket._devices = [];

		for( let id of ids ){

			if( typeof id !== 'string' )
				continue;

			// Add the device if not found
			let pos = socket._devices.indexOf(id);
			if( pos === -1 ){
				
				socket._devices.push(id);
				// Tell any connected devices with this id that an app is now connected to it
				this.sendToRoom(Server.deviceSelfRoom(id), TASKS.TASK_ADD_APP, [
					socket._app_name || '',
					socket.id
				]);

				// Join the app room for the device
				socket.join(Server.deviceAppRoom(id));

				// Get any devices actively connected with this id and raise connection events to the app
				io.in(Server.deviceSelfRoom(id)).clients((err, clients) => {
					if( err )
						return;
					for( let s of clients )
						this.sendToSocket(socket, TASKS.TASK_DEVICE_ONLINE, [
							id, s
						]);
				});
				

			}

		}

		res(socket._devices);

	}

	// Removes a device from an app connection
	onAppHookdown( socket, ids, res ){

		if( !Array.isArray(ids) )
			ids = [ids];

		if( !Array.isArray(socket._devices) )
			socket._devices = [];

		for( let id of ids ){

			if( typeof id !== "string" )
				continue;

			let pos = socket._devices.indexOf(id);
			if( ~pos ){
				
				socket._devices.splice(pos, 1);
				// Tell any connected devices with this id that the app has disconnected
				this.sendToRoom(Server.deviceSelfRoom(id), TASKS.TASK_APP_OFFLINE, [
					socket._app_name || '',
					socket.id
				]);

			}

		}

		res(socket._devices);

	}

	onAppName( socket, name, res ){

		if( typeof name !== "string" )
			return;

		name = name.substr(0, 128);

		// Leave old room
		if( socket._app_name )
			socket.leave(Server.appSelfRoom(socket._app_name));

		// Join new room
		socket._app_name = name;
		if( name )
			socket.join(Server.appSelfRoom(name));

		// Tell any connected devices that we changed name
		this.sendToDevicesByAppSocket(socket, TASKS.TASK_ADD_APP, [
			socket._app_name || '',
			socket.id
		]);

		res(true);

	}


	// DATA
	// Buffer to send to all 4
	onSocketPWM( socket, buffer ){

		/*
			Buffer should be an ArrayBuffer with a UInt8Array or a hex string that can be converted to one. 
			Hex can be especially useful if you're limited to 32 bits.
			The first value is the device index, the following values sets the duty cycle on the port between 0 and 255
			Ex: 0 255 255 255 255 would set all 4 ports to 100% intensity on device index 0 
		*/
		this.debug("Buffer received ", buffer, typeof buffer);

		if( typeof buffer === "string" ){
			
			let buf = new Buffer(8);
			for( let i=0; i < buffer.length/2; ++i )
				buf[i] = parseInt(buffer.substr(i*2, 2), 16);
			buffer = buf;
			
		}

		if( !buffer || buffer.constructor !== Buffer || !Array.isArray(socket._devices) )
			return;
		

		let view = new Uint8Array(buffer);
		let index = view[0];

		let device = socket._devices[index];
		if( !device )
			return;

		// Ok we found the device, build it
		let v = new Uint8Array(4);
		v[0] = view[1] || 0;	// Begin at 1 because 
		v[1] = view[2] || 0;
		v[2] = view[3] || 0;
		v[3] = view[4] || 0;
		
		let hex = Buffer.from(v).toString('hex');
		this.sendToRoom(
			Server.deviceSelfRoom(device), 
			TASKS.TASK_PWM,
			hex
		);

	}

	// GET Request received from webserver
	onGet( req, res ){

		let out = {
			status : 400,
			message : 'OK',
		};

		let id = req.query.id,
			data = req.query.data,
			type = req.query.type,
			allowed_types = [
				"vib"
			]
		;

		try{
			data = JSON.parse(data);
		}catch(e){
			//console.error(e);
		}

		if( 
			!id || !data || !type ||
			typeof id !== 'string' ||
			(typeof data !== 'object' && !Array.isArray(data)) ||
			typeof type !== 'string'			
		){
			out.message = 'Invalid query string. Expecting id = (str)deviceID, data = (jsonObject)data, type = (str)messageType<br />Received id['+typeof id+'], data['+typeof data+'], type['+typeof type+']';
		}
		else if( allowed_types.indexOf(type) === -1 )
			out.message = 'Invalid type specified. Supported types are:<ul><li>'+allowed_types.join('</li><li>')+'</li></ul>';
		else{
			
			status = 200;
			this.sendToRoom(Server.deviceSelfRoom(id), type, data);

		}
		res.status(out.status);
		res.send(out.message);

	}

	// Custom data to a device by id
	onCustomToDevice( socket, data ){

		if( !Array.isArray(data) || !Array.isArray(socket._devices) )
			return;
		
		// This app is not connected to the device
		let id = data.shift();
		if( !id || socket._devices.indexOf(id) === -1 )
			return;
		
		// Ok now we can send it
		this.sendToRoom(Server.deviceSelfRoom(id), TASKS.TASK_CUSTOM_TO_DEVICE, [
			data.shift(), 
			socket._app_name || '', 
			socket.id
		]);

	}

	// Sends custom data to app if the device this is sent from is connected to it
	onCustomToApp( socket, data ){

		// Data malformed or socket is not a device
		if( !Array.isArray(data) || !socket._device_id )
			return;

		let name = data.shift();
		if( typeof name !== "string" )
			return;

		Server.isSocketConnectedToApp(socket, name)
		.catch(err => {console.error(err);})
		.then(yes => {

			if( !yes )
				return;

			this.sendToRoom(Server.appSelfRoom(name), TASKS.TASK_CUSTOM_TO_APP, [
				socket._device_id,
				socket.id,
				data.shift()
			]);

		});

		
		
	}
	



	// Send message to device
	sendToRoom( id, type, data ){

		io.to(id).emit(type, data);
		this.debug("Emitting ", type, "to", id, "with data",data);

	}

	sendToSocket( socket, type, data ){

		socket.emit(type, data);
		this.debug("Emitting ", type, "to a direct socket with data",data);

	}

	// Sends message to all devices connected to an app socket
	sendToDevicesByAppSocket( socket, type, data ){

		if( !Array.isArray(socket._devices) )
			return;

		for( let device of socket._devices )
			this.sendToRoom(
				Server.deviceSelfRoom(device), 
				type,
				data
			);

	}

	sendToAppsByDeviceSocket( socket, type, data ){

		if( socket._device_id )
			this.sendToRoom(
				Server.deviceAppRoom(socket._device_id), 
				type,
				data
			);

	}


	debug(){

		if( !this.allowDebug )
			return;

		console.log.apply(this, arguments);

	}

	// STATIC
	// Converts an ID into a device target room. This room is only joined by the device itself.
	static deviceSelfRoom( id ){
		return id+"_d";
	}
	// Converts an ID to an app target room. This room is joined by apps connecting to device id
	static deviceAppRoom( id ){
		return id+"_a"; 
	}

	// Converts an app name to a room for that app
	static appSelfRoom( name ){
		return name+"_as";
	}

	// Returns a promise resolving to sockets currently controlling a device id
	static getAppsControllingDevice( socket ){

		let devid = socket._device_id;

		if( !devid )
			return [];

		let out = [];
		let ns = io.of("/");
		// make sure this socket is actually connected to that app
		return new Promise((res, rej) => {

			io.in(Server.deviceAppRoom(devid)).clients((err, clients) => {

				if( err )
					return rej(err);

				for( let s of clients ){
					
					let socket = ns.connected[s];
					if( socket )
						out.push(socket);

				}

				res(out);

			});

		});

	}


	// Checks if a device socket is connected to an app by name
	// returns a promise which resolves to true or false
	static isSocketConnectedToApp( socket, appName ){

		let devid = socket._device_id;
		if( !devid )
			return;

		let ns = io.of("/");
		// make sure this socket is actually connected to that app
		
		return new Promise((res, rej) => {

			io.in(Server.appSelfRoom(appName)).clients((err, clients) => {

				if( err )
					return rej(err);

				if( clients.length )
					return res(true);

				res(false);

			});

		});

	}

}


module.exports = Server;
