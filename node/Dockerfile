FROM node:26
WORKDIR /node/app
CMD test -d "node_modules" && npm run start || npm install && npm run start
