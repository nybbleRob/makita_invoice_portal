# Makita Invoice Portal v2

A modern, full-stack invoice management portal built with React and Node.js. This application provides comprehensive document management for invoices, credit notes, and statements with automated processing, email notifications, and multi-tenant company support.

## Tech Stack

### Frontend
- **React 18** - Modern UI library with hooks
- **React Router 6** - Client-side routing
- **Axios** - HTTP client
- **Tabler UI** - Beautiful admin dashboard template
- **PDF.js** - PDF viewing and rendering
- **XLSX** - Excel file parsing and export

### Backend
- **Node.js** - JavaScript runtime
- **Express.js** - Web application framework
- **Sequelize** - PostgreSQL ORM
- **BullMQ** - Redis-based job queue for background processing
- **Nodemailer** - Email sending
- **JWT** - JSON Web Token authentication
- **Helmet** - Security middleware
- **Winston** - Logging

### Database & Cache
- **PostgreSQL** - Primary relational database
- **Redis** - Job queues, caching, and session management

### Document Processing
- **Google Document AI** - Intelligent document parsing
- **PDF-Parse** - PDF text extraction
- **Sharp** - Image processing

### Infrastructure
- **PM2** - Process manager for Node.js
- **FTP/SFTP** - Automated file import from remote servers

## Features

### Document Management
- Upload and process invoices, credit notes, and statements
- Automatic PDF parsing with field extraction
- Bulk import from CSV/Excel files
- Duplicate detection
- Document versioning and audit trail

### Company Management
- Hierarchical company structure (CORP, SUB, BRANCH)
- Nested set model for efficient tree queries
- Company-specific email contacts and notification preferences
- EDI (Electronic Data Interchange) support

### User Management
- Role-based access control (Global Admin, Administrator, Manager, Staff, External User, Notification Contact)
- Two-factor authentication (2FA) with TOTP
- Password policies with expiration
- Session management with Redis

### Email Notifications
- Configurable email templates
- Smart throttling (rate limiting to prevent SMTP blocks)
- Retry logic with exponential backoff
- Summary emails for bulk imports
- Attachment support

### Background Processing
- BullMQ job queues for async operations
- Scheduled tasks (document retention, cleanup)
- FTP/SFTP file monitoring and import
- Dead letter queue for failed jobs

### Security
- Helmet security headers
- CORS protection
- Rate limiting
- Password hashing with bcrypt
- JWT token authentication
- Activity logging and audit trail

## Project Structure

```
├── backend/
│   ├── config/          # Database, Redis, queue configuration
│   ├── jobs/            # BullMQ job processors
│   ├── middleware/      # Express middleware (auth, rate limiting)
│   ├── models/          # Sequelize models
│   ├── routes/          # API routes
│   ├── scripts/         # Database migrations and utilities
│   ├── services/        # Business logic services
│   ├── utils/           # Helper utilities
│   ├── workers/         # Queue workers and scheduler
│   └── server.js        # Express application entry point
├── frontend/
│   ├── public/          # Static assets
│   └── src/
│       ├── components/  # Reusable React components
│       ├── context/     # React context providers
│       ├── pages/       # Page components
│       ├── services/    # API service layer
│       └── utils/       # Frontend utilities
├── ecosystem.config.js  # PM2 configuration
└── README.md
```

## Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Redis 6+
- PM2 (for production)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/nybbleRob/makita_invoice_portal.git
cd makita_invoice_portal
```

### 2. Install dependencies

```bash
# Backend dependencies
cd backend
npm install

# Frontend dependencies
cd ../frontend
npm install
```

### 3. Configure environment

Create a `.env` file in the `backend` directory:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=invoice_portal
DB_USER=postgres
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=your_secret_key
JWT_EXPIRES_IN=24h

# Email (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASS=your_password
SMTP_FROM=noreply@example.com

# Email Rate Limiting
EMAIL_RATE_MAX=4
EMAIL_RATE_DURATION_MS=60000
EMAIL_WORKER_CONCURRENCY=1

# Google Document AI (optional)
GOOGLE_PROJECT_ID=your_project
GOOGLE_PROCESSOR_ID=your_processor
GOOGLE_LOCATION=us

# Server
PORT=5000
NODE_ENV=development
```

### 4. Initialize the database

```bash
cd backend
npm run create:admin
```

### 5. Start the application

#### Development

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm start
```

#### Production (with PM2)

```bash
# Build frontend
cd frontend
npm run build

# Start all services
pm2 start ecosystem.config.js

# View logs
pm2 logs

# Monitor
pm2 monit
```

## PM2 Services

| Service | Description |
|---------|-------------|
| `invoice-portal-backend` | Main Express API server |
| `invoice-portal-queue-worker` | BullMQ job processor |
| `invoice-portal-scheduler` | Scheduled tasks runner |

## API Documentation

The API follows RESTful conventions:

- `GET /api/invoices` - List invoices
- `POST /api/invoices` - Create invoice
- `GET /api/companies` - List companies
- `POST /api/users` - Create user
- `POST /api/auth/login` - User login
- `GET /api/settings` - Application settings

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 5000 |
| `DB_HOST` | PostgreSQL host | localhost |
| `REDIS_HOST` | Redis host | localhost |
| `JWT_SECRET` | JWT signing secret | - |
| `JWT_EXPIRES_IN` | Token expiration | 24h |
| `EMAIL_RATE_MAX` | Emails per duration | 4 |
| `EMAIL_RATE_DURATION_MS` | Rate limit window | 60000 |

## License

ISC

## Author

Built with React and Node.js

