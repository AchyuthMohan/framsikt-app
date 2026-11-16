# Use official lightweight Node.js 20 Alpine image
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package manifests first to leverage Docker layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy backend logic, tests, and frontend static files
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Expose the application port
EXPOSE 3000

# Run the Express server
CMD ["npm", "start"]