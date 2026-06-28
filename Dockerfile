FROM node:22-alpine

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Set default port
ENV PORT=30128

# Expose port
EXPOSE 30128

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:30128/healthz').catch(()=>process.exit(1))"

# Start server
CMD ["node", "server.js"]
