const
	express = require("express"),
	app = express(),
	http = require("http").Server(app),
	io = require("socket.io")(http),
	cors = require("cors"),
	TASKS = require("./Tasks"),
	fs = require('fs')
;

class Server{

	constructor(){

		// Server base configuration
		this.config = {
			port : 80,
			debug : false
		};

	}

	async begin(){

		try{
			await this.loadConfig();
		}catch(err){
			console.error("Unable to load config, using default. Error: ", err);
		}
		// Begin
		this.allowDebug = this.config.debug;
		this.port = +this.config.port;
			
		// Start HTTP listening
		http.listen(this.port, () => {
			console.log("Server online", this.port);
		});


		app.use('/api',cors());
		app.use('/cdn',cors());
		app.use(express.static(__dirname+'/public'));
		
		
		
		// Handle http requests
		app.get('/api', (req, res) => { 
			this.onGet(req, res); 
		});

		// Handle WS requests
		io.on("connection", socket => {

			this.debug("sIO New generic connection established");

			socket.on("disconnect", () => { this.onDisconnect(socket); });
			socket.on(TASKS.TASK_ADD_DEVICE, id => { this.onDeviceConnected(socket, id); });
			socket.on(TASKS.TASK_HOOKUP, (id, res) => { this.onAppHookup(socket, id, res); });
			socket.on(TASKS.TASK_HOOKDOWN, (id, res) => { this.onAppHookdown(socket, id, res); });
			socket.on(TASKS.TASK_PWM, hex => { this.onSocketPWM(socket, hex); });
			socket.on(TASKS.TASK_ADD_APP, (name, res) => { this.onAppName(socket, name, res); });
			socket.on(TASKS.TASK_CUSTOM_TO_DEVICE, data => { this.onCustomToDevice(socket, data); });
			socket.on(TASKS.TASK_CUSTOM_TO_APP, data => { this.onCustomToApp(socket, data); });
			socket.on(TASKS.TASK_GET, async data => { 
					
					this.debug("Program received", JSON.stringify(data), typeof data);
					if( typeof data !== "object" )
						return this.debug("Program is not acceptable, expected object, got ", typeof data);

					try{
						await this.handleGet(data.id, data.data, data.type);
						this.debug("Program successfully accepted");
					}catch( err ){
						this.debug("Program error", err);
					}

				});
				socket.on(TASKS.TASK_PWM_SPECIFIC, hex => { this.onSocketPWM(socket, hex, TASKS.TASK_PWM_SPECIFIC); });

		});

	}


	loadConfig(){

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
	
							if( this.config.hasOwnProperty(i) ){
	
								if( typeof this.config[i] === typeof json[i] )
									this.config[i] = json[i];
								else
									console.log("Invalid type of config", i, "got", typeof json[i], "expected", typeof this.config[i]);
	
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

	// makes sure device id is valid, throws a catchable exception if not, otherwise returns the ID
	formatDeviceID( id ){

		if( typeof id !== "string" )
			throw "Invalide device ID type";

		if( id.length < 10 || id.length > 64 )
			throw "Invalid device ID size";

		return id.toUpperCase();

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
	async onDeviceConnected( socket, id ){

		try{
			id = this.formatDeviceID(id);
		}catch(err){
			return this.debug(err);
		}

		socket.leaveAll();
		socket.join(Server.deviceSelfRoom(id));
		socket._device_id = id;

		// Tell any apps subscribed to this id that a device has come online
		this.sendToAppsByDeviceSocket(socket, TASKS.TASK_DEVICE_ONLINE, [id, socket.id]);
		this.debug("device", id, "is now listening");

		try{
			let apps = await Server.getAppsControllingDevice(socket);
			for( let app of apps )
				this.sendToSocket(socket, TASKS.TASK_ADD_APP, [app._app_name || '', app.id]);
		}
		catch(err){
			console.error("Unable to get apps controlling device", err);
		}
		
	}

	// Adds one or more devices to an app connection
	onAppHookup( socket, ids, res ){
		
		if( !Array.isArray(ids) )
			ids = [ids];

		if( !Array.isArray(socket._devices) )
			socket._devices = [];

		for( let id of ids ){

			try{
				id = this.formatDeviceID(id);
			}catch(err){
				continue;
			}

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

		if( !Array.isArray(socket._devices) )
			socket._devices = [];

		// Delete all
		if( Array.isArray(ids) && !ids.length )
			ids = socket._devices;

		if( !Array.isArray(ids) )
			ids = [ids]; 


		for( let id of ids ){

			try{
				id = this.formatDeviceID(id);
			}catch(err){
				continue;
			}

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
		socket._app_name = name;
		// Tell any connected devices that we changed name
		this.sendToDevicesByAppSocket(socket, TASKS.TASK_ADD_APP, [
			socket._app_name || '',
			socket.id
		]);

		res(true);

	}


	// DATA
	// Forwards a hex string to the device
	onSocketPWM( socket, hex, task ){

		this.debug("Hex received ", hex);
		task = task || TASKS.TASK_PWM;

		if( 
			typeof hex !== "string" || 				// Hex is not a string
			hex.length < 4 || 						// Hex needs to contain at least 2 bytes
			hex.length%2 ||							// Hex is not a multiple of 2
			!hex.match(/-?[0-9a-fA-F]+/) ||		// Hex is not hexadecimal
			!Array.isArray(socket._devices)			// The socket is not an app
		)return;
			
		let index = parseInt(hex.substr(0, 2), 16);
		let device = socket._devices[index];
		if( !device )
			return;

		this.sendToRoom(
			Server.deviceSelfRoom(device), 
			task,
			hex.substr(2).toLowerCase()
		);

	}

	// Program request via socket, works the same as GET
	onSocketProgram( socket, program ){

		if( typeof program !== 'object' && !Array.isArray(program) )
			return;

		this.sendToRoom(Server.deviceSelfRoom(), type, data);

	}

	// handles a REST task
	handleGet( id, data, type ){

		if( typeof data !== "object" && !Array.isArray(data) )
			data = JSON.parse(data);

		let allowed_types = [
			"vib"
		];

		id = this.formatDeviceID(id);

		if( 
			!data || !type ||
			(typeof data !== 'object' && !Array.isArray(data)) ||
			typeof type !== 'string'			
		)throw 'Invalid query string. Expecting id = (str)deviceID, data = (jsonObject)data, type = (str)messageType<br />Received id['+typeof id+'], data['+typeof data+'], type['+typeof type+']';
		
		if( allowed_types.indexOf(type) === -1 )
			throw 'Invalid type specified. Supported types are:<ul><li>'+allowed_types.join('</li><li>')+'</li></ul>';

		id = id.toUpperCase();
		this.sendToRoom(Server.deviceSelfRoom(id), type, data);

	}

	// GET Request received from webserver
	onGet( req, res ){

		let out = {
			status : 400,
			message : 'OK',
		};

		let data = req.query.data;

		try{
			this.handleGet(req.query.id, data, req.query.type);
			out.status = 200;
		}
		catch(err){
			out.message = err;
			if( typeof err === "object" && err.message )
				out.message = err.message;
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
		try{
			id = this.formatDeviceID(id);
		}catch(err){
			return this.debug(err);
		}

		if( socket._devices.indexOf(id) === -1 )
			return;

		id = id.toUpperCase();

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

		// Device ID is case sensitive, device is not
		let id = data.shift(),
			output = data.shift()
		;
		if( typeof id !== "string" )
			return;

		let app = io.sockets.sockets[id];
		if( !app )
			return;

		// This device is not connected to the app
		if( !Array.isArray(app._devices) || app._devices.indexOf(socket._device_id) === -1 )
			return;
		
		// All clear
		this.sendToSocket(app, TASKS.TASK_CUSTOM_TO_APP, [
			socket._device_id,
			socket.id,
			output
		]);
		
		
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



}


module.exports = Server;
