const
	express = require("express"),
	app = express(),
	http = require("http").Server(app),
	io = require("socket.io")(http)
;

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
		app.get('/api', (req, res) => {
			th.onGet(req, res);
		});

	
		// Handle WS requests
		io.on("connection", socket => {

			th.debug("Client Connected");

			socket.on("disconnect", () => {
				th.debug("Client disconnected");
			});

			// An ID was received FROM a device
			socket.on("id", id => {

				if( typeof id !== 'string' )
					return th.debug("Invalid ID for room join");
				

				socket.leaveAll();
				socket.join(id);
				th.debug("device", id, "is now listening");

			});


			// Sets up a shortcut for hookup
			socket.on("hookup", (id, res) => {

				if( typeof id === 'string' ){

					if( !Array.isArray(socket._devices) )
						socket._devices = [];
					
					let pos = socket._devices.indexOf(id);
					if( pos === -1 )
						socket._devices.push(id);

				}

				res(socket._devices);


			});

			// removes a hook
			socket.on('hookdown', (id, res) => {

				if( !Array.isArray(socket._devices) )
					socket._devices = [];

				let pos = socket._devices.indexOf(id);
				if( ~pos )
					socket._devices.splice(pos, 1);


				res(socket._devices);
			});

			// A data request to be forwarded TO a device
			/*
				Buffer should be an ArrayBuffer with a UInt8Array. The first value is the device index, the following values sets the duty cycle on the port between 0 and 255
				Ex: 0 255 255 255 255 would set all 4 ports to 100% intensity on device index 0 
			*/
			socket.on("p", buffer => {

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
                this.sendToDevice(device, "p", hex);
				
			});

		});

	}


	// GET Request received
	onGet( req, res ){

		let out = {
			status : 200,
			message : 'OK',
		};

		let id = req.query.id,
			data = req.query.data,
			type = req.query.type
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
		else
			this.sendToDevice(id, type, data);

		res.status(out.status);
		res.send(out.message);

	}

	// Send message to device
	sendToDevice( id, type, data ){

		io.to(id).emit(type, data);
		this.debug("Emitting ", type, "to", id, "with data",data);

	}

	debug(){

		if( !this.allowDebug )
			return;

		console.log.apply(this, arguments);

	}

}



module.exports = Server;
