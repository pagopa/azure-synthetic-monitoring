FROM node:18.19.0-buster

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app
COPY package.json ./
USER node
RUN npm install
COPY --chown=node:node src/*.js .
CMD [ "node", "synthetic-monitoring.js" ]
