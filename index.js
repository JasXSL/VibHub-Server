const fs = require('fs'),
	Server = require('./Server'),
	config = {
		port : 6969,
		debug : false
	}
;
// Defaults
let port = 6969,
	debug = false
;

// Get config
fs.readFile(__dirname+'/config.json', 'utf8', (err, data) => {
		
	if( err )
		return console.error("Unable to read config, using defaults:", err.code);
		
	try{

		let json = JSON.parse(data);
		if( typeof json !== "object" )
			throw Error('Config is not an object');

		else{

			for( let i in json ){

				if( config.hasOwnProperty(i) ){

					if( typeof config[i] === typeof json[i] )
						config[i] = json[i];
					else
						console.log("Invalid type of config", i, "got", typeof json[i], "expected", typeof config[i]);

				}
				else
					console.log("Unknown config property", i);

			}

		}

	}catch(e){
		console.error(e);
	}
	
	// Begin
	new Server(config);


	
});
	




