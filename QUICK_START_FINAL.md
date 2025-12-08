# 🚀 Quick Start - Get Everything Running

## Step-by-Step Setup

### 1. Start Services (WSL)

**Open WSL terminal:**
```bash
wsl

# Start PostgreSQL
sudo service postgresql start

# Start Redis (optional)
sudo service redis-server start

# Verify
redis-cli ping
# Should return: PONG
```

### 2. Create Database (if not exists)

```bash
# In WSL
sudo -u postgres psql
CREATE DATABASE invoice_portal;
\q
```

### 3. Backend Setup

```bash
cd backend

# Install dependencies (if not done)
npm install

# Test connection
npm run test:db
# Should see: ✅ PostgreSQL Connected Successfully

# Start server
npm run dev
```

**Expected output:**
```
✅ PostgreSQL Connected Successfully
✅ Database synchronized
✅ Redis: Connected Successfully
🚀 Server is running on port 5000
```

### 4. Create Admin User

**In a NEW terminal:**
```bash
cd backend
npm run create:admin
```

**Output:**
```
✅ Admin user created successfully!
📧 Login Credentials:
   Email: admin@isg-reporting.com
   Password: admin123
```

### 5. Frontend Setup

**In a NEW terminal:**
```bash
cd frontend

# Install dependencies (if not done)
npm install

# Start frontend
npm start
```

**Expected:**
- Browser opens to http://localhost:3000
- Or manually navigate there

### 6. Login

- **URL:** http://localhost:3000
- **Email:** `admin@isg-reporting.com`
- **Password:** `admin123`
- ⚠️ **Change password immediately!**

---

## Troubleshooting

### Backend won't start

**PostgreSQL not running:**
```bash
wsl
sudo service postgresql start
```

**Database doesn't exist:**
```bash
wsl
sudo -u postgres psql
CREATE DATABASE invoice_portal;
\q
```

**Port 5000 in use:**
```bash
# Kill process on port 5000
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

### Frontend won't start

**Port 3000 in use:**
```bash
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Can't connect to backend:**
- Check backend is running
- Verify `REACT_APP_API_URL=http://localhost:5000` in `frontend/.env`

---

## What's Ready

✅ **Backend:**
- PostgreSQL configured
- All routes converted to Sequelize
- Redis configured (optional)
- Admin creation script updated
- Database sync working

✅ **Frontend:**
- API configured
- Environment variables set
- Routes ready

✅ **Database:**
- PostgreSQL with Customer hierarchy support
- All models converted
- Relationships defined

---

## Summary

1. ✅ Start PostgreSQL & Redis in WSL
2. ✅ Create database (`invoice_portal`)
3. ✅ Start backend (`npm run dev`)
4. ✅ Create admin (`npm run create:admin`)
5. ✅ Start frontend (`npm start`)
6. ✅ Login and change password

**You're ready to go!** 🎉


