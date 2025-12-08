# Complete Setup Checklist - Get Everything Running

## ✅ Pre-Flight Check

### 1. Prerequisites Installed
- [ ] Node.js (v14+) - `node --version`
- [ ] npm - `npm --version`
- [ ] PostgreSQL installed in WSL
- [ ] Redis installed in WSL (optional)

---

## Backend Setup

### 2. Start PostgreSQL
```bash
# In WSL terminal
wsl
sudo service postgresql start

# Verify it's running
sudo service postgresql status
```

### 3. Create Database
```bash
# In WSL
sudo -u postgres psql
CREATE DATABASE invoice_portal;
\q
```

### 4. Start Redis (Optional)
```bash
# In WSL
sudo service redis-server start

# Verify
redis-cli ping
# Should return: PONG
```

### 5. Backend Environment File
**File:** `backend/.env`

```env
PORT=5000
NODE_ENV=development

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=invoice_portal
DB_USER=postgres
DB_PASSWORD='your_postgres_password'
DB_SSL=false

# JWT Secret (generate secure random string)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-characters-long

# Redis (Optional)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Frontend URL
FRONTEND_URL=http://localhost:3000
```

### 6. Install Backend Dependencies
```bash
cd backend
npm install
```

### 7. Test Backend Connection
```bash
cd backend

# Test PostgreSQL
node -e "require('./config/database').testConnection()"
# Should see: ✅ PostgreSQL Connected Successfully

# Test Redis (if configured)
node -e "require('./config/redis').testConnection()"
# Should see: ✅ Redis: Connection Test Successful
```

### 8. Start Backend Server
```bash
cd backend
npm run dev
```

**Expected output:**
```
✅ PostgreSQL Connected Successfully
✅ Database synchronized
✅ Redis: Connected Successfully (if Redis is running)
🚀 Server is running on port 5000
📍 Environment: development
```

### 9. Create Admin User
**In a NEW terminal:**
```bash
cd backend
npm run create:admin
```

**Expected output:**
```
✅ Admin user created successfully!
📧 Login Credentials:
   Email: admin@isg-reporting.com
   Password: admin123
```

---

## Frontend Setup

### 10. Frontend Environment File
**File:** `frontend/.env`

```env
REACT_APP_API_URL=http://localhost:5000
```

### 11. Install Frontend Dependencies
```bash
cd frontend
npm install
```

### 12. Start Frontend Server
```bash
cd frontend
npm start
```

**Expected:**
- Browser opens automatically to `http://localhost:3000`
- Or manually navigate to `http://localhost:3000`

---

## Login & Test

### 13. Login
- **URL:** http://localhost:3000
- **Email:** `admin@isg-reporting.com`
- **Password:** `admin123`
- ⚠️ **Change password immediately after first login!**

---

## Troubleshooting

### Backend Issues

**PostgreSQL Connection Failed:**
```bash
# Check PostgreSQL is running
wsl
sudo service postgresql status

# Start if not running
sudo service postgresql start

# Verify database exists
sudo -u postgres psql -l
```

**Redis Connection Failed:**
- Redis is optional - app works without it
- To fix: `sudo service redis-server start` in WSL

**Port 5000 Already in Use:**
```bash
# Windows PowerShell
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Or change PORT in backend/.env
```

### Frontend Issues

**Port 3000 Already in Use:**
```bash
# Windows PowerShell
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Or set PORT environment variable
$env:PORT=3001; npm start
```

**Can't Connect to Backend:**
- Check backend is running on port 5000
- Verify `REACT_APP_API_URL` in `frontend/.env`
- Check CORS settings (should be enabled)

**Module Not Found:**
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

---

## Quick Start Commands

### Terminal 1 - Backend:
```bash
cd backend
npm run dev
```

### Terminal 2 - Frontend:
```bash
cd frontend
npm start
```

### Terminal 3 - Create Admin (one-time):
```bash
cd backend
npm run create:admin
```

---

## Verification Checklist

- [ ] PostgreSQL running (`sudo service postgresql status`)
- [ ] Database exists (`invoice_portal`)
- [ ] Redis running (optional - `redis-cli ping`)
- [ ] Backend `.env` configured
- [ ] Frontend `.env` configured
- [ ] Backend dependencies installed
- [ ] Frontend dependencies installed
- [ ] Backend server running (port 5000)
- [ ] Frontend server running (port 3000)
- [ ] Admin user created
- [ ] Can login at http://localhost:3000

---

## What's Fixed

✅ **Backend:**
- All routes converted to Sequelize
- PostgreSQL connection configured
- Redis connection configured (optional)
- Admin creation script updated
- Database sync working

✅ **Frontend:**
- API configuration correct
- Environment variables set up
- Routes configured

---

## Next Steps After Setup

1. **Login** - Use admin credentials
2. **Change Password** - Security first!
3. **Explore Dashboard** - Check out features
4. **Create Customers** - Test parent/child hierarchy
5. **Create Reports** - Test CRUD operations

---

## Summary

**Backend:** ✅ Ready (PostgreSQL + Sequelize)
**Frontend:** ✅ Ready (React + API configured)
**Database:** ✅ PostgreSQL with Customer hierarchy support
**Redis:** ✅ Optional (caching, sessions, rate limiting)

**Everything should work now!** 🎉


