const
	express = require("express"),
	app = express(),
	http = require("http").Server(app),
	io = require("socket.io")(http),
	TASKS = require("./Tasks")
;

/*
	Socket tasks explained:

*/

class Server{

	constructor( config ){

		let th = this;

		this.allowDebug = config.debug;
		this.port = +config.port;
		
		// Start HTTP listening
		http.listen(this.port, () => {
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
			socket.on(TASKS.TASK_ADD_APP, (name) => { th.onAppName(socket, name); });

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

	onAppName( socket, name ){

		if( typeof name !== "string" )
			return;

		name = name.substr(0, 128);
		socket._app_name = name;
		
		// Tell any connected devices that we changed name
		this.sendToDevicesByAppSocket(socket, TASKS.TASK_ADD_APP, [
			socket._app_name || '',
			socket.id
		]);

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

}


module.exports = Server;
