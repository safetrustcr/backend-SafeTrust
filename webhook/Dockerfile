# Use a specific version for reproducibility
FROM node:18-alpine

# Set production environment
ENV NODE_ENV=production

# Create app directory and set ownership to non-root user
# Create app directory
WORKDIR /app
RUN chown node:node /app

# Install dependencies as root, but only production ones
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

# Copy app source code with correct ownership
# Ensure app directory is owned by node user
RUN chown node:node /app

# Copy dependency files first for better caching
COPY --chown=node:node package*.json ./

# Install only production dependencies
# Using npm install because package-lock.json is not present in the workspace
RUN npm install --omit=dev

# Copy the rest of the application
COPY --chown=node:node . .

# Switch to non-root user
USER node

EXPOSE 3001

CMD ["npm", "start"]
