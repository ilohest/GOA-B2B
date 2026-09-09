FROM node:22-alpine

# age fournit le chiffrement asymétrique : le conteneur ne détient que la clé
# publique, jamais de quoi déchiffrer une sauvegarde.
RUN apk add --no-cache age

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY index.mjs ./

USER node
CMD ["node", "index.mjs"]
