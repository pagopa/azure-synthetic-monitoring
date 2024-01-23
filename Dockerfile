FROM node:18.19.0-buster

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app
COPY package.json ./
USER node
RUN npm install
COPY --chown=node:node src/synthetic-monitoring.js .
#ENV APP_INSIGHT_CONNECTION_STRING=InstrumentationKey=f3d23a26-e8eb-430e-8ea6-d158a570d6ce;IngestionEndpoint=https://northeurope-2.in.applicationinsights.azure.com/;LiveEndpoint=https://northeurope.livediagnostics.monitor.azure.com/
CMD [ "node", "synthetic-monitoring.js" ]
