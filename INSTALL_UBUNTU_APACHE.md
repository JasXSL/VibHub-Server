# Setting up Vibhub with SSL on Ubuntu Server 18.04 + Apache + Let's Encrypt

This is my setup for testing. -Kadah

## Prerequisites

A registered domain name pointing to where the server will be hosted, this recipe will use example.com
The ability to host services on ports 80 and 443, some crappy ISPs still block these.


## OS Setup

### Install 18.04

Configure network as needed
Recommended: Install OpenSSH during install
Recommended: Don't use a shitty password

### Post install

Recommended: Change SSH port and use private key auth instead of password (out of scope for this document)

Do updates, install packages
```
sudo apt update
sudo apt dist-upgrade
sudo apt install apache2 git
```

### (Optional) Enable firewall

```
sudo ufw allow OpenSSH
sudo ufw allow 'Apache Full'
sudo ufw enable
sudo ufw status
```

### Install Node.js

I used v12, it seems to work.
```
curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## Setup Vibhub

Optional: Made a new user specifically to run VibHub

Pull code
```
mkdir ~/vibhub
git clone https://github.com/JasXSL/VibHub-Server.git ~/vibhub
cd ~/vibhub
```

Change port to something other than 80, I used 8080
`nano Server.js`

```
// Server base configuration
this.config = {
        port : 8080,
        debug : false,
};
```

Setup server
```
npm init
npm install
```

Run server to make sure it work then kill
`node index.js`

## Install and configure PM2

This will automatically run the Vibhub server on system start.
Change <username> to your username, or username for VibHub
```
sudo npm install -g pm2
sudo pm2 start ~/vibhub/index.js -n VibHub -u <username>
sudo pm2 startup systemd
```

## Configure Apache

Make folder for website. This is currently unused.
```
sudo mkdir /var/www/html/vibhub
sudo chown <username>:<username> /var/www/html/vibhub
```

Enable proxy modules
```
sudo a2enmod rewrite
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod proxy_wstunnel
sudo service apache2 restart
```

Disable default site
`sudo a2dissite 000-default.conf`

Create vibhub.conf
`sudo nano /etc/apache2/sites-available/vibhub.conf`

Change example.com to your domain.
```
ServerName example.com

<VirtualHost *:80>
	ServerAdmin webmaster@example.com
	ServerName example.com
	ServerAlias example.com

	DocumentRoot /var/www/html/vibhub
	<Directory />
		Options -Indexes +FollowSymLinks
		AllowOverride None
		Require all granted
	</Directory>

	RewriteEngine On
	RewriteCond %{REQUEST_URI}  ^socket.io          [NC]
	RewriteCond %{QUERY_STRING} transport=websocket [NC]
	RewriteRule /{.*}       ws://localhost:8080/$1  [P,L]

	RewriteCond %{HTTP:Connection} Upgrade [NC]
	RewriteRule /(.*) ws://localhost:8080/$1 [P,L]

	ProxyPass /nodejs http://localhost:8080/
	ProxyPassReverse /nodejs http://localhost:8080/

	ProxyPass /socket.io http://localhost:8080/socket.io
	ProxyPassReverse /socket.io http://loacalhost:8080/socket.io

	ProxyPass /socket.io ws://localhost:8080/socket.io
	ProxyPassReverse /socket.io ws://localhost:8080/socket.io

	ErrorLog ${APACHE_LOG_DIR}/error.log
	# Possible values include: debug, info, notice, warn, error, crit,
	# alert, emerg.
	LogLevel warn
	CustomLog ${APACHE_LOG_DIR}/access.log combined
</VirtualHost>
```

Enable new config
`sudo a2ensite vibhub.conf`

Check config, fix errors if any
`sudo apache2ctl configtest`

Reload Apache
`sudo systemctl reload apache2`

Verify it works. Eveything over HTTP should work at this point. Browser pointing to your domain should show "Index of /". VibHub device pointing to your domain should work over port 80.

## Obtain SSL Cert

Install Certbot
```
sudo add-apt-repository ppa:certbot/certbot
sudo apt install python-certbot-apache
```

Certbot makes this easy. Change domain to your domain. Add any domains or sub domains you'd like the cert to be valid for with -d
`sudo certbot --apache -d example.com`

When prompted to `redirect HTTP traffic to HTTPS`, you should choose redirect but it will work if you do not.

Reload Apache
`sudo systemctl reload apache2`

Everything should now be functional over HTTPS.
