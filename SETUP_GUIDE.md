# 🚀 Complete Setup Guide - Invoice Portal

## Quick Answers to Your Questions

### 1. **Do you need a new database?**
**Yes!** You'll need to set up a MongoDB database (either local or cloud). The project doesn't come with a pre-configured database.

### 2. **Is PostgreSQL better than MongoDB?**
**For this project: Stick with MongoDB** because:
- ✅ The entire codebase is already built with MongoDB/Mongoose
- ✅ Switching to PostgreSQL would require rewriting all models, schemas, and queries
- ✅ MongoDB works excellently for invoice/document management (flexible schemas)
- ✅ PostgreSQL would be better if you need complex transactions/joins, but that's not necessary here

**PostgreSQL would be better if:**
- You need strict ACID transactions across multiple tables
- You need complex SQL queries with many joins
- You prefer relational data modeling

**MongoDB is better for:**
- Flexible document structures (perfect for invoices with varying fields)
- Rapid development (already set up!)
- JSON-like data (matches JavaScript/React naturally)
- This project (already configured!)

---

## 📋 Step-by-Step Setup Instructions

### Prerequisites
- ✅ Node.js (v14 or higher) - [Download](https://nodejs.org/)
- ✅ npm (comes with Node.js)
- ✅ MongoDB (choose one option below)

---

## Step 1: Install Dependencies

The project already has `node_modules` folders, but verify dependencies are installed:

**Backend:**
```bash
cd backend
npm install
```

**Frontend:**
```bash
cd frontend
npm install
```

---

## Step 2: Set Up Database

### Option A: MongoDB Atlas (Cloud - Recommended for Quick Start) ⭐

**Why Atlas?**
- No installation needed
- Free tier (512MB)
- Works immediately
- Accessible from anywhere

**Steps:**
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
2. Sign up for free account
3. Create a free cluster (M0 - Free tier)
4. Create database user:
   - Go to "Database Access" → "Add New Database User"
   - Username: `admin` (or your choice)
   - Password: Generate secure password (save it!)
   - Database User Privileges: "Atlas admin"
5. Configure Network Access:
   - Go to "Network Access" → "Add IP Address"
   - For development: Click "Allow Access from Anywhere" (0.0.0.0/0)
   - For production: Add specific IPs
6. Get Connection String:
   - Go to "Database" → "Connect" → "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database user password
   - Replace `<dbname>` with `invoice-portal` (or your choice)

**Example connection string:**
```
mongodb+srv://admin:yourpassword@cluster0.xxxxx.mongodb.net/invoice-portal?retryWrites=true&w=majority
```

### Option B: Local MongoDB

**Why Local?**
- Works offline
- Faster queries (no network latency)
- Full control
- No cloud dependency

**Steps:**
1. Download MongoDB Community Server: [Download](https://www.mongodb.com/try/download/community)
2. Install MongoDB (follow installer instructions)
3. Start MongoDB service:
   - **Windows:** MongoDB should start automatically as a service
   - **Mac:** `brew services start mongodb-community`
   - **Linux:** `sudo systemctl start mongod`
4. Verify it's running:
   ```bash
   mongod --version
   ```

**Default connection:** `mongodb://localhost:27017/invoice-portal`

---

## Step 3: Create Environment Files

### Backend Environment (`backend/.env`)

Create `backend/.env` file:

**For MongoDB Atlas:**
```env
PORT=5000
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/invoice-portal?retryWrites=true&w=majority
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
NODE_ENV=development
```

**For Local MongoDB:**
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/invoice-portal
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
NODE_ENV=development
```

**Generate a secure JWT_SECRET:**
```bash
# On Windows PowerShell:
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})

# On Mac/Linux:
openssl rand -base64 32
```

### Frontend Environment (`frontend/.env`)

Create `frontend/.env` file:
```env
REACT_APP_API_URL=http://localhost:5000
```

---

## Step 4: Test Database Connection

```bash
cd backend
npm run test:db
```

**Expected output:**
```
✅ MongoDB Connected Successfully!
```

**If you see errors:**
- **Atlas:** Check connection string, username/password, IP whitelist
- **Local:** Check MongoDB is running (`mongod --version`)

---

## Step 5: Create Admin User

```bash
cd backend
npm run create:admin
```

This creates:
- **Email:** `admin@isg-reporting.com`
- **Password:** `admin123`
- **Role:** `global_admin`

⚠️ **Important:** Change password after first login!

---

## Step 6: Start the Application

### Terminal 1 - Backend Server:
```bash
cd backend
npm run dev
```

**Expected output:**
```
✅ MongoDB Connected Successfully
🚀 Server is running on port 5000
📍 Environment: development
```

### Terminal 2 - Frontend Server:
```bash
cd frontend
npm start
```

**Expected output:**
- Browser automatically opens to `http://localhost:3000`
- Or manually navigate to `http://localhost:3000`

---

## Step 7: Login

1. Go to `http://localhost:3000`
2. Login with:
   - **Email:** `admin@isg-reporting.com`
   - **Password:** `admin123`
3. **Change password immediately** after first login!

---

## ✅ Setup Checklist

- [ ] Node.js installed (`node --version`)
- [ ] Backend dependencies installed (`cd backend && npm install`)
- [ ] Frontend dependencies installed (`cd frontend && npm install`)
- [ ] MongoDB set up (Atlas or Local)
- [ ] Redis set up (Optional but recommended - see `REDIS_SETUP.md`)
- [ ] `backend/.env` file created with correct `MONGODB_URI` and optional `REDIS_*` settings
- [ ] `frontend/.env` file created with `REACT_APP_API_URL`
- [ ] Database connection tested (`npm run test:db`)
- [ ] Redis connection verified (check server logs or `/api/health`)
- [ ] Admin user created (`npm run create:admin`)
- [ ] Backend server running (`npm run dev`)
- [ ] Frontend server running (`npm start`)
- [ ] Can login at `http://localhost:3000`

---

## 🛠️ Useful Commands

### Backend:
```bash
npm run dev          # Start development server (with auto-reload)
npm start            # Start production server
npm run test:db      # Test MongoDB connection
npm run create:admin # Create admin user
npm run check        # Check setup status
```

### Frontend:
```bash
npm start            # Start development server
npm run build        # Build for production
npm test             # Run tests
```

---

## 🐛 Troubleshooting

### MongoDB Connection Issues

**Error: "authentication failed"**
- Check username/password in connection string
- Verify database user exists in Atlas
- Ensure password doesn't have special characters (URL encode if needed)

**Error: "IP not whitelisted" (Atlas)**
- Go to Atlas → Network Access
- Add your IP or allow 0.0.0.0/0 for development

**Error: "ENOTFOUND" or "getaddrinfo"**
- Check cluster URL is correct
- Verify connection string format
- Check internet connection (for Atlas)

**Error: "MongoDB connection error" (Local)**
- Check MongoDB is running: `mongod --version`
- Start MongoDB service
- Verify port 27017 is not blocked

### Port Already in Use

**Backend (port 5000):**
```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Or change PORT in backend/.env
```

**Frontend (port 3000):**
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Or set PORT environment variable
# Windows PowerShell:
$env:PORT=3001; npm start
```

### Frontend Can't Connect to Backend

- Verify backend is running on port 5000
- Check `REACT_APP_API_URL` in `frontend/.env`
- Check CORS settings in backend
- Check browser console for errors

### Module Not Found Errors

- Delete `node_modules` and `package-lock.json`
- Run `npm install` again
- Clear npm cache: `npm cache clean --force`

---

## 📚 Next Steps After Setup

1. **Change Admin Password** - Security first!
2. **Explore the Dashboard** - Check out all features
3. **Configure Settings** - Branding, colors, logos
4. **Create Test Data** - Add users, reports, invoices
5. **Customize** - Start building your features

---

## 🔄 Switching Between Atlas and Local MongoDB

**From Atlas to Local:**
1. Install MongoDB locally
2. Export data from Atlas (if needed)
3. Update `MONGODB_URI` in `backend/.env` to `mongodb://localhost:27017/invoice-portal`
4. Restart backend server

**From Local to Atlas:**
1. Create Atlas cluster
2. Export local data (if needed)
3. Update `MONGODB_URI` in `backend/.env` to Atlas connection string
4. Restart backend server

**The code stays the same!** Just change the connection string.

---

## 💡 Pro Tips

- **Development:** Use MongoDB Atlas (easier, no installation)
- **Production:** Use MongoDB Atlas (managed, scalable, backups)
- **Offline Work:** Use Local MongoDB
- **Team Collaboration:** Use MongoDB Atlas (shared database)
- Keep `.env` files secure (never commit them!)
- Use different databases for dev/staging/production
- Regularly backup your database

---

## 🆘 Need Help?

- Check `QUICK_START.md` for condensed guide
- Check `LOCAL_SETUP.md` for local MongoDB setup
- Check `ATLAS_SETUP.md` for MongoDB Atlas setup
- Check `MONGODB_COMPARISON.md` for database comparison
- Review `README.md` for project overview

---

## 🎉 You're Ready!

Once you can login at `http://localhost:3000`, you're all set! Start building your invoice portal features.

