# VibHub-Server
Self hosted server for the VibHub vibrator system.

Looking to create your own USB Toy? Use [VibHub Client](https://github.com/JasXSL/VibHub-Client)

This software is not required if you want to use the JasX hosted relay.

Install via docker:

1. `git clone https://github.com/JasXSL/VibHub-Server`
2. `cd VibHub-Server`
3. `sudo docker compose up`
4. Long press the button on your VibHub and enter the web portal. Then change the VibHub server to the IP of the machine you installed the server on.

Install manually:

1. Git clone the project into any folder you want.
2. Rename config.json.small to config.json
3. `npm install`
4. `node index`

More documentation will come later.
