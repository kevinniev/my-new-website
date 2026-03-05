# Frontend build stage
FROM node:14 AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Backend build stage
FROM node:14 AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./

# Final stage
FROM node:14
WORKDIR /app
# Copy frontend build artifacts
COPY --from=frontend-build /app/frontend/dist ./frontend
# Copy backend build artifacts
COPY --from=backend-build /app/backend ./backend

# Expose the port the app runs on
EXPOSE 3000
CMD ["node", "backend/server.js"]