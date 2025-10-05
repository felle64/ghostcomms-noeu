# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy configuration files
COPY tsconfig.json ./
COPY prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Verify build output (for debugging)
RUN ls -la /app/dist

# ---- runtime stage ----
FROM node:20-alpine
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy dependencies and generated files from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

# Copy package.json for metadata
COPY --from=build /app/package.json ./package.json

# Expose the application port
EXPOSE 8080

# Start command with database migration and server startup
CMD sh -c "npx prisma db push && node dist/index.js"