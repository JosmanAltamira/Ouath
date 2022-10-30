FROM node:8.15.1-alpine

WORKDIR /usr/src/oauth-quickstart-nodejs

# Install
COPY ./index.js ./
COPY ./package.json ./
RUN npm install

ENV CLIENT_ID="e7f13238-af5b-4a9f-85f0-2c00a631c5d0"
ENV CLIENT_SECRET="e0869ccf-d1d5-4620-836d-e5de5de083f5"
ENV SCOPE="crm.objects.contacts.read,forms"

EXPOSE 3000

ENTRYPOINT [ "node", "index.js" ]
