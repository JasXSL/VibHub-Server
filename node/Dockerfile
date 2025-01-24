FROM node:22.13.0
WORKDIR /node/app
CMD test -d "node_modules" && npm run start || npm install && npm run start
