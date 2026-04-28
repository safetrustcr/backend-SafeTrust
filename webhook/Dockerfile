# Use a specific version for reproducibility
FROM node:18-alpine

# Set production environment
ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Ensure app directory is owned by node user
RUN apk add --no-cache curl
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
