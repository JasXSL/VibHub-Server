const Tasks = require('./Tasks'),
	tVals = Object.values(Tasks);

class DeviceInfo{

	constructor( data ){

		if( typeof data != "object" )
			data = {};

		this.numPorts = parseInt(data.numPorts) || 0;			// Nr ports supported by device
		this.version = data.version ? String(data.version).substring(0, 64) : '???';		// Max 64 characters
		this.hwversion = data.hwversion ? String(data.hwversion).substring(0, 64) : '???';		// Max 64 characters
		this.custom = data.custom ? String(data.custom).substring(0, 256) : '';			// Custom data, max 256 characters
		
		this.capabilities = {};									// taskName : true / false / "custom"
		if( typeof data.capabilities === "object" ){

			for( let i in data.capabilities ){

				i = String(i).toLowerCase();
				if( tVals.includes(i) ){

					let val = Boolean(data.capabilities[i]);
					if( typeof data.capabilities[i] === "string" ) 
						val = String(data.capabilities[i]).toLowerCase().substring(0,32); // Capabilities can be max 32 bytes 

					this.capabilities[i] = val;

				}

			}

		}

	}

	export(){

		return {
			hwversion : this.hwversion,
			numPorts : this.numPorts,
			version : this.version,
			custom : this.custom,
			capabilities : this.capabilities,
		};

	}


}

module.exports = DeviceInfo;



