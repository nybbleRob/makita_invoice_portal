# Redis Setup in WSL - Quick Guide

## ✅ Install Redis in WSL

Since you have WSL, install Redis exactly like PostgreSQL:

### Step 1: Install Redis

**In WSL terminal:**
```bash
# Open WSL
wsl

# Update package list
sudo apt update

# Install Redis
sudo apt install redis-server

# Start Redis
sudo service redis-server start
```

### Step 2: Verify Installation

```bash
# Test Redis
redis-cli ping
# Should return: PONG
```

### Step 3: Enable Auto-Start (Optional)

```bash
# Enable Redis to start on boot
sudo systemctl enable redis-server

# Or add to .bashrc for WSL auto-start:
echo "sudo service redis-server start > /dev/null 2>&1" >> ~/.bashrc
```

### Step 4: Update .env File

Your `backend/.env` should already have:
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

**No changes needed** - these are the defaults!

### Step 5: Test Connection

```bash
cd backend
node -e "require('./config/redis').testConnection()"
```

Should see: `✅ Redis: Connection Test Successful`

---

## Quick Commands

```bash
# Start Redis
sudo service redis-server start

# Stop Redis
sudo service redis-server stop

# Check status
sudo service redis-server status

# Restart Redis
sudo service redis-server restart

# Test connection
redis-cli ping
```

---

## Troubleshooting

### "Connection refused"
**Fix:** Redis not running
```bash
sudo service redis-server start
```

### "command not found: redis-cli"
**Fix:** Redis not installed
```bash
sudo apt install redis-server
```

### Port 6379 already in use
**Fix:** Another Redis instance running
```bash
# Check what's using port 6379
sudo netstat -tulpn | grep 6379

# Stop other Redis instances
sudo service redis-server stop
```

---

## That's It!

Once Redis is running, your app will automatically connect to it. You'll see:
```
✅ Redis: Connected Successfully
```

**Redis is optional** - your app works without it, but it's better with it! 🚀


