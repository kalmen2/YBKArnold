FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp

RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-calc libreoffice-core python3 python3-uno fonts-liberation fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY index.mjs convert.py ./

USER node
EXPOSE 8080
CMD ["npm", "start"]
