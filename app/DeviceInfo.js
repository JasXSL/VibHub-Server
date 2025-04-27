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
		
		this.batLastRead = 0;		// Last battery read
		this.batLow = false;		// Battery low status
		this.batMv = 0;				// Current millivolts
		this.batXv = 0;				// Max millivolts

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

	// Returns true if we should update the clients
	addBatteryReading( lowStatus, mv, xv ){
		
		this.batLow = Boolean(lowStatus);
		this.batMv = parseInt(mv) || 0;
		this.batXv = parseInt(xv) || 0;

		if( Date.now() - this.batLastRead > 10e3 ){
			this.batLastRead = Date.now();
			return true;
		}
		return false;

	}

	exportBattery(){
		return {
			last : Math.floor(this.batLastRead/1000),
			low : this.batLow,
			mv : this.batMv,
			xv : this.batXv
		};
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



