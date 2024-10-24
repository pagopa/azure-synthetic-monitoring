FROM node:18.19.0-buster@sha256:7a7c4663f8cf434a66a10ebb33e749663454aa284e3b9ccb79c454f6925c752d

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app
COPY package.json ./
USER node
RUN npm install
COPY --chown=node:node src/*.js .
CMD [ "node", "synthetic-monitoring.js" ]
