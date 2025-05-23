FROM node:18-alpine3.16 as build

WORKDIR /build

COPY ["package.json", "package-lock.json", "./"]

RUN apk update && apk add python3 make gcc g++
RUN npm install --quiet

COPY . .

RUN npm run build

FROM node:18-alpine3.16

LABEL org.opencontainers.image.title="Nostream"
LABEL org.opencontainers.image.source=https://github.com/Cameri/nostream
LABEL org.opencontainers.image.description="nostream"
LABEL org.opencontainers.image.authors="Ricardo Arturo Cabral Mejía"
LABEL org.opencontainers.image.licenses=MIT

WORKDIR /app
RUN apk add --no-cache --update git
RUN apk update && apk add python3 make gcc g++

ADD resources /app/resources

COPY --from=build /build/dist .

RUN npm install --omit=dev --quiet

USER node:node

CMD ["node", "--inspect=0.0.0.0", "src/index.js"]
