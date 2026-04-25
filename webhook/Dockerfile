# Use a specific version for reproducibility
FROM node:18-alpine

# Set production environment
ENV NODE_ENV=production

# Create app directory and set ownership to non-root user
WORKDIR /app
RUN chown node:node /app

# Install dependencies as root, but only production ones
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

# Copy app source code with correct ownership
COPY --chown=node:node . .

# Switch to non-root user
USER node

EXPOSE 3001

CMD ["npm", "start"]
