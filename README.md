# Phantom Lag - Redis Authentication System

Complete authentication system for Phantom Lag using Redis on Railway.

## Structure
- `/server` - Node.js Redis API server
- `/client` - C++ client with authentication
- `/admin` - Web admin panel (optional)

## Quick Start

### Server Deployment
1. Fork this repository
2. Connect to Railway
3. Add Redis database
4. Deploy automatically

### Client Setup
1. Update `REDIS_AUTH_URL` in auth.h
2. Compile with your existing Phantom Lag code

## API Endpoints
- `POST /validate` - Validate license key
- `POST /check` - Check license status  
- `POST /admin/create` - Create new licenses
- `GET /health` - Health check

## Environment Variables
- `REDIS_URL` - Redis connection string
- `ADMIN_KEY` - Admin authentication key
