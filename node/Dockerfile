FROM node
WORKDIR /node/app
COPY .env* ./
CMD rm -f package.json && \
	if grep -q "^FULL_INSTALL=true" .env 2>/dev/null; then \
	ln -s package.json.full package.json; \
	else \
	ln -s package.json.small package.json; \
	fi && \
	test -d "node_modules" && npm run start || npm install && npm run start
