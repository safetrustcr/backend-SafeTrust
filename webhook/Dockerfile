FROM node:18-alpine

WORKDIR /usr/src/webhook

RUN apk add --no-cache curl
COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "index.js"] 