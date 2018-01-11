const app = require("express")(),
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
	
		// Handle http requests
		app.get('/', (req, res) => {
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
				Buffer should be an ArrayBuffer of 3x 8bit bytes.
				0 = device(setup by hookup), 1 = Task, 2 = intensity between 0 and 100
			*/
			socket.on("p", buffer => {

				if( !buffer || buffer.constructor !== Buffer || !Array.isArray(socket._devices) )
					return;
				

				let view = new Int8Array(buffer);
				let index = view[0],
					task = view[1],
					val = view[2]
				;

				if( !socket._devices[index] )
					return;

				// Ok we found the device, send
				let device = socket._devices[index];
				buffer = new ArrayBuffer(2);
				view = new Int8Array(buffer);
				view[0] = task;
				view[1] = val;
				
				this.sendToDevice(device, "p", buffer);
				
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
			typeof data !== 'object' ||
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
		this.debug("Emitting ", type, "to", id);

	}

	debug(){

		if( !this.allowDebug )
			return;

		console.log.apply(this, arguments);

	}

}



module.exports = Server;
