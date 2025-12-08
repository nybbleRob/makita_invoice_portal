# 🎯 Get Everything Running - Complete Guide

## ✅ What's Been Fixed

### Backend:
- ✅ All routes converted from Mongoose → Sequelize
- ✅ PostgreSQL connection configured
- ✅ Redis connection configured (optional)
- ✅ Admin creation script updated
- ✅ Test connection script updated
- ✅ Database sync working
- ✅ All models converted (User, Report, Settings, Customer)

### Frontend:
- ✅ API service configured
- ✅ Environment variables ready
- ✅ Routes configured

---

## 🚀 Quick Start (5 Steps)

### Step 1: Start PostgreSQL & Redis (WSL)

```bash
# Open WSL
wsl

# Start PostgreSQL
sudo service postgresql start

# Start Redis (optional)
sudo service redis-server start

# Verify
redis-cli ping
# Should return: PONG
```

### Step 2: Verify Database Exists

```bash
# In WSL
sudo -u postgres psql -l | grep invoice_portal

# If not found, create it:
sudo -u postgres psql
CREATE DATABASE invoice_portal;
\q
```

### Step 3: Start Backend

```bash
cd backend
npm run dev
```

**Wait for:**
```
✅ PostgreSQL Connected Successfully
✅ Database synchronized
🚀 Server is running on port 5000
```

### Step 4: Create Admin User

**In a NEW terminal:**
```bash
cd backend
npm run create:admin
```

### Step 5: Start Frontend

**In a NEW terminal:**
```bash
cd frontend
npm start
```

**Browser opens:** http://localhost:3000

**Login:**
- Email: `admin@isg-reporting.com`
- Password: `admin123`

---

## 📋 Environment Files Checklist

### `backend/.env` ✅
```env
PORT=5000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=invoice_portal
DB_USER=postgres
DB_PASSWORD='your_password'
DB_SSL=false
JWT_SECRET=your-secret-key-min-32-chars
REDIS_HOST=localhost
REDIS_PORT=6379
FRONTEND_URL=http://localhost:3000
```

### `frontend/.env` ✅
```env
REACT_APP_API_URL=http://localhost:5000
```

---

## 🔍 Verify Everything Works

### Test Backend:
```bash
cd backend

# Test PostgreSQL
npm run test:db
# Should see: ✅ PostgreSQL Connected Successfully

# Test Redis (if configured)
node -e "require('./config/redis').testConnection()"
# Should see: ✅ Redis: Connection Test Successful
```

### Test Frontend:
- Open http://localhost:3000
- Should see login page
- Login with admin credentials

### Test API:
```bash
# Health check
curl http://localhost:5000/api/health

# Should return:
{
  "status": "OK",
  "database": "Connected",
  "redis": "Connected"
}
```

---

## 🐛 Common Issues & Fixes

### Issue: "PostgreSQL Connection Error"
**Fix:**
```bash
wsl
sudo service postgresql start
```

### Issue: "Database does not exist"
**Fix:**
```bash
wsl
sudo -u postgres psql
CREATE DATABASE invoice_portal;
\q
```

### Issue: "Port 5000 already in use"
**Fix:**
```bash
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

### Issue: "Redis connection failed"
**Fix:**
- Redis is optional - app works without it
- To fix: `sudo service redis-server start` in WSL

### Issue: "Module not found"
**Fix:**
```bash
cd backend
rm -rf node_modules package-lock.json
npm install

cd ../frontend
rm -rf node_modules package-lock.json
npm install
```

---

## ✅ Final Checklist

- [ ] PostgreSQL running (`sudo service postgresql status`)
- [ ] Redis running (optional - `redis-cli ping`)
- [ ] Database exists (`invoice_portal`)
- [ ] `backend/.env` configured
- [ ] `frontend/.env` configured
- [ ] Backend dependencies installed (`npm install` in backend)
- [ ] Frontend dependencies installed (`npm install` in frontend)
- [ ] Backend server running (`npm run dev`)
- [ ] Admin user created (`npm run create:admin`)
- [ ] Frontend server running (`npm start`)
- [ ] Can login at http://localhost:3000

---

## 🎉 You're Ready!

Once you can login, everything is working! Start building your invoice portal with customer hierarchies.

**All routes are converted, all models are ready, everything is configured!** 🚀


