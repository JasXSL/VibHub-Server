const { debug } = require("console");
const Tasks = require("./Tasks");

const
	express = require("express"),
	app = express(),
	http = require("http").Server(app),
	io = require("socket.io")(http),
	cors = require("cors"),
	TASKS = require("./Tasks"),
	fs = require('fs'),
	DeviceInfo = require("./DeviceInfo")
;

class Server{

	constructor(){

		// Server base configuration
		this.config = {
			port : 80,
			debug : false,
			device_id_min_size : 10,
			device_id_max_size : 128,
			device_id_case_sensitive : false,
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
		app.use('/socket.io',cors());
		// If you want a custom front end when visited in a browser etc, you can create a /site/index.js file to drive that
		if( fs.existsSync(__dirname+'/site/index.js') ){
			
			const site = require('./site/index.js');
			site(app, io);

		}
		
		
		// Handle http requests
		app.get('/api', (req, res) => { 
			this.onGet(req, res); 
		});

		// Handle WS requests
		io.on("connection", socket => {

			this.debug("sIO New user connected");

			socket.on("disconnect", () => { this.onDisconnect(socket); });
			socket.on(TASKS.TASK_ADD_DEVICE, (data, res) => { this.onDeviceConnected(socket, data, res); });
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
			throw "Invalid device ID type";

		if( id.length < this.config.device_id_min_size || id.length > this.device_id_max_size )
			throw "Invalid device ID size. Must be between "+this.device_id_min_size+" and "+this.device_id_max_size+" bytes.";

		if( this.device_id_case_sensitive )
			return id;
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
	// Data can be a string id for "anonymous" devices, or an object with metadata
	async onDeviceConnected( socket, data, res ){

		let id = data;
		if( typeof data === "object" )
			id = data.id;
		else
			data = {};

		try{

			id = this.formatDeviceID(id);

		}catch(err){

			res({error : "Invalid ID"});
			return this.debug(err);

		}

		socket.leaveAll();

		// Yeet any existing devices in this room, there can be only one!
		try{
			
			const sockets = await this.getSocketsInRoom(Server.deviceSelfRoom(id));
			if( sockets )
				sockets.map(socket => socket.disconnect());

		}catch(err){
			this.debug(err);
			return;
		}
		

		socket.join(Server.deviceSelfRoom(id));
		socket._device_id = id;
		socket._device_info = new DeviceInfo(data);

		// Tell any apps subscribed to this id that a device has come online
		this.sendToAppsByDeviceSocket(socket, TASKS.TASK_DEVICE_ONLINE, [id, socket.id, socket._device_info.export()]);

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

	// Returns all sockets in a room. Returns a PROMISE, or false if the room is invalid
	getSocketsInRoom( room ){

		if( typeof room !== "string" )
			return false;

		return new Promise((res, rej) => {
			
			io.in(room).clients((err, ids) => {

				if( err ){
					rej(err);
					return;
				}
	
				const out = [];
				ids.forEach(id => {
					out.push(io.sockets.sockets[id]);
				});
				res(out);
	
			});

		});

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
				// There should only be one, but might as well
				this.getSocketsInRoom(Server.deviceSelfRoom(id))
					.then(sockets => {

						for( let s of sockets ){

							let dinfo = new DeviceInfo();
							if( s._device_info )
								dinfo = s._device_info;

							this.sendToSocket(socket, TASKS.TASK_DEVICE_ONLINE, [
								id, s.id, dinfo.export()
							]);

						}

					})
					.catch(err => this.debug(err));

				

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

		if( !Array.isArray(program) )
			return;

		this.sendToRoom(Server.deviceSelfRoom(), type, data);

	}

	// handles a REST task
	async handleGet( id, data, type ){

		if( typeof id !== "string" )
			throw "Request device ID invalid. Use id=deviceID in GET request.";

		if( !Array.isArray(data) && typeof data !== "string" )
			throw "Request data invalid. Should be a JSON array. Use data=[...] in GET request.";

		if( typeof type !== "string" )
			throw "Request type invalid. Use type=requestType in GET request.";

		if( !Array.isArray(data) )
			data = JSON.parse(data);
		
		// ID always required
		id = this.formatDeviceID(id);
		if( !this.config.device_id_case_sensitive )
			id = id.toUpperCase();

		if( type === Tasks.TASK_VIB ){

			if( !Array.isArray(data) )
				throw "Data must be an array.";

			this.sendToRoom(Server.deviceSelfRoom(id), type, data);

		}
		else if( type === Tasks.TASK_WHOIS ){

			const sockets = await this.getSocketsInRoom(Server.deviceSelfRoom(id));
			let data = new DeviceInfo();
			if( sockets.length && sockets[0]._device_info )
				data = sockets[0]._device_info;
			
			return data.export();

		}
		

		else 
			throw 'Unknown call type.';

		
		

	}

	// GET Request received from webserver
	async onGet( req, res ){

		let out = {
			status : 400,
			message : 'OK',
		};


		try{

			let message = await this.handleGet(
				req.query.id, 
				req.query.data, 
				req.query.type
			);
			if( message )
				out.message = message;
			out.status = 200;

		}
		catch(err){

			out.message = {error : err};
			if( typeof err === "object" && err.message )
				out.message = err.message;

		}

		res.status(out.status);
		res.json({
			message : out.message,
			success : out.status === 200
		});

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

		if( !this.config.device_id_case_sensitive )
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
