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
- **Node.js 20 LTS** - JavaScript runtime
- **Express.js 4** - Web application framework
- **Sequelize 6** - PostgreSQL ORM with migrations
- **BullMQ** - Redis-based job queue for background processing
- **Nodemailer** - Email sending with multiple provider support
- **JWT** - JSON Web Token authentication
- **Helmet** - Security middleware
- **Winston** - Structured logging with rotation

### Database & Cache
- **PostgreSQL 14+** - Primary relational database
- **Redis 6+** - Job queues, caching, session management, and activity logs

### Email Providers
Supports multiple email providers with easy switching via Settings UI:
- **SMTP** - Standard SMTP server
- **Mailtrap** - Email testing/sandbox (captures all emails for testing)
- **Office 365** - Microsoft Graph API integration
- **Resend** - Modern email API
- **SMTP2Go** - Transactional email service

### Document Processing
- **Google Document AI** - Intelligent document parsing with template matching
- **PDF-Parse** - PDF text extraction fallback
- **Sharp** - Image processing and optimization
- **XLSX** - Excel file parsing for bulk imports

### Infrastructure
- **PM2** - Process manager with clustering and auto-restart
- **SFTP/FTP** - Automated file import from customer uploads
- **Nginx** - Reverse proxy and static file serving
- **Ubuntu 24.04 LTS** - Production server OS

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
│   ├── config/          # Database, Redis, queue, storage configuration
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

## File Storage Structure

Production file storage on separate data drive (`/mnt/data`):

```
/mnt/data/
├── invoice-portal/
│   └── uploads/              # SFTP upload folder (customer drops files here)
├── processed/
│   ├── invoices/YYYY/MM/DD/  # Successfully processed invoices
│   ├── creditnotes/YYYY/MM/DD/
│   └── statements/YYYY/MM/DD/
└── unprocessed/
    ├── duplicates/YYYY-MM-DD/ # Duplicate files (hash match)
    └── failed/YYYY-MM-DD/     # Failed imports (with .error.txt logs)
```

## Prerequisites

- Node.js 20 LTS (v20.19.6 recommended)
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

The application runs as 3 separate PM2 processes:

| Service | Description | Script |
|---------|-------------|--------|
| `invoice-portal-backend` | Main Express API server | `backend/server.js` |
| `invoice-portal-queue-worker` | BullMQ job processor | `backend/workers/queueWorker.js` |
| `invoice-portal-scheduler` | Scheduled tasks runner | `backend/workers/scheduler.js` |

### PM2 Management Commands

```bash
# Start all services
pm2 start ecosystem.config.js

# Start individual service
pm2 start ecosystem.config.js --only invoice-portal-backend

# Stop all services
pm2 stop all

# Restart all services
pm2 restart all

# View logs
pm2 logs
pm2 logs invoice-portal-backend

# Monitor
pm2 monit

# View status
pm2 status
```

### Background Job Queues

The queue worker processes jobs from the following BullMQ queues:

1. **file-import** - Process uploaded files (PDF/Excel parsing, company matching)
2. **bulk-parsing-test** - Bulk parsing tests for template validation
3. **invoice-import** - Invoice import jobs from FTP/manual upload
4. **email** - Email sending with rate limiting and retry logic
5. **scheduled-tasks** - Scheduled cleanup and maintenance jobs
6. **nested-set** - Company hierarchy reindexing (background updates)

### Scheduled Tasks

The scheduler runs the following periodic tasks:

- **Document Retention Cleanup** - Removes documents past retention period
- **File Cleanup** - Cleans up temporary and orphaned files
- **FTP Scanner** - Monitors FTP/SFTP directories for new files
- **Local Folder Scanner** - Scans local directories for imports

## API Documentation

The API follows RESTful conventions. All routes require authentication unless otherwise noted.

### Authentication & Users
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token
- `GET /api/users` - List users (admin only)
- `POST /api/users` - Create user (admin only)
- `GET /api/users/:id` - Get user details
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user
- `GET /api/profile` - Get current user profile
- `PUT /api/profile` - Update current user profile
- `POST /api/two-factor/setup` - Setup 2FA
- `POST /api/two-factor/verify` - Verify 2FA code
- `POST /api/two-factor/disable` - Disable 2FA

### Documents
- `GET /api/invoices` - List invoices (filtered by user's accessible companies)
- `POST /api/invoices` - Create invoice
- `GET /api/invoices/:id` - Get invoice details
- `PUT /api/invoices/:id` - Update invoice
- `DELETE /api/invoices/:id` - Delete invoice
- `GET /api/credit-notes` - List credit notes
- `POST /api/credit-notes` - Create credit note
- `GET /api/credit-notes/:id` - Get credit note details
- `GET /api/statements` - List statements
- `GET /api/unallocated` - List unallocated documents
- `POST /api/unallocated/:id/allocate` - Attempt to allocate document
- `GET /api/failed` - List failed imports

### Companies & Configuration
- `GET /api/companies` - List companies (hierarchical)
- `POST /api/companies` - Create company
- `GET /api/companies/:id` - Get company details
- `PUT /api/companies/:id` - Update company
- `DELETE /api/companies/:id` - Delete company
- `GET /api/settings` - Get application settings (global admin only)
- `PUT /api/settings` - Update application settings (global admin only)
- `GET /api/templates` - List supplier templates
- `POST /api/templates` - Create template
- `GET /api/column-config` - Get column configurations

### Processing & Import
- `POST /api/parsing/test-parse` - Test PDF parsing
- `POST /api/parsing/bulk-test` - Bulk parsing test
- `POST /api/files/upload` - Upload file
- `GET /api/files/:id` - Get file details
- `GET /api/ftp/test` - Test FTP connection
- `GET /api/ftp/list` - List FTP files
- `POST /api/ftp/import` - Import from FTP
- `GET /api/import-settings` - Get import settings
- `PUT /api/import-settings` - Update import settings
- `POST /api/users/import` - Bulk import users (Excel)

### Other
- `GET /api/reports` - List reports
- `POST /api/reports` - Create report
- `GET /api/document-queries` - List document queries
- `POST /api/document-queries` - Create query
- `GET /api/activity-logs` - List activity logs (admin only)
- `GET /api/stats` - Get statistics

## Environment Variables

### Required Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | PostgreSQL host | localhost |
| `DB_PASSWORD` | PostgreSQL password | - |
| `JWT_SECRET` | JWT signing secret | - |

### Optional Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 5000 |
| `NODE_ENV` | Environment (development/production) | development |
| `DB_PORT` | PostgreSQL port | 5432 |
| `DB_NAME` | Database name | invoice_portal |
| `DB_USER` | Database user | postgres |
| `DB_SSL` | Enable SSL for database | false |
| `REDIS_HOST` | Redis host | localhost |
| `REDIS_PORT` | Redis port | 6379 |
| `REDIS_PASSWORD` | Redis password | - |
| `REDIS_URL` | Redis connection URL | - |
| `JWT_EXPIRES_IN` | Token expiration | 24h |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | http://localhost:3000,http://localhost:5000 |
| `EMAIL_RATE_MAX` | Emails per duration window | 10 |
| `EMAIL_RATE_DURATION_MS` | Rate limit window (ms) | 10000 |
| `EMAIL_WORKER_CONCURRENCY` | Email worker concurrency | 1 |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google credentials file | - |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Google credentials as JSON string | - |
| `GOOGLE_CLOUD_PROJECT_ID` | Google Cloud project ID | - |
| `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` | Document AI processor ID | - |
| `GOOGLE_CLOUD_LOCATION` | Document AI location | us |
| `DATA_DRIVE_PATH` | Base path for file storage | /mnt/data |
| `FTP_UPLOAD_PATH` | FTP/SFTP upload directory | /mnt/data/invoice-portal/uploads |
| `PROCESSED_PATH` | Processed files directory | /mnt/data/processed |
| `UNPROCESSED_PATH` | Unprocessed files directory | /mnt/data/unprocessed |

## Data Models

### Core Entities

- **User** - User accounts with role-based access control
  - Roles: `global_admin`, `administrator`, `manager`, `credit_senior`, `credit_controller`, `external_user`, `notification_contact`
  - Supports 2FA, password policies, session management
  
- **Company** - Hierarchical company structure
  - Types: `CORP` (Corporate/Parent), `SUB` (Subsidiary), `BRANCH` (Branch)
  - Uses nested set model for efficient tree queries
  - Company-specific email notification preferences
  
- **Invoice/CreditNote/Statement** - Document entities
  - Linked to companies and users
  - Supports metadata, versioning, retention dates
  - Status tracking (draft, ready, sent, paid, overdue, cancelled)
  
- **File** - File tracking and versioning
  - Hash-based duplicate detection
  - File path tracking and metadata
  
- **DocumentQuery** - Customer query system for document inquiries
  
- **Settings** - Application-wide configuration
  - Email provider settings
  - Parsing provider configuration
  - Branding and theming
  
- **EmailLog** - Email delivery tracking and history
  
- **ImportTransaction** - Bulk import tracking and status

### Key Relationships

- Users ↔ Companies (many-to-many via `UserCompany` join table)
- Companies have hierarchical parent-child relationships
- Documents belong to Companies
- Users have role-based permissions for document access
- Credit Notes can be linked to Invoices

## Middleware

The application uses several Express middleware layers:

- **auth.js** - JWT token verification and user authentication
- **permissions.js** - Role-based permission checking (`requirePermission`, `requireAdmin`)
- **documentAccess.js** - Company-based document filtering (ensures users only see documents from their accessible companies)
- **rateLimiter.js** - API rate limiting (separate limiters for auth, API, and general routes)
- **activityLog.js** - Activity logging middleware for audit trail
- **globalAdmin.js** - Global admin route protection

## Production Server

**Server Details:**
- Domain: `edi.makitauk.com`
- SSH: `rob@Makita-InvPortal-02`
- Project Path: `/var/www/makita-invportal`
- Internal IP: `172.16.254.202`
- External IP: `185.194.254.165` (via WatchGuard firewall)

**PM2 Process Names:**
- `invoice-portal-backend`
- `invoice-portal-queue-worker`
- `invoice-portal-scheduler`

## Development vs Production

### Development Mode
- Workers run in main server process (no separate queue worker needed)
- Auto-restart on file changes (nodemon)
- Detailed console logging
- Database auto-sync enabled

### Production Mode
- Separate PM2 processes for backend, queue-worker, and scheduler
- Log rotation with Winston
- Health monitoring and heartbeats via Redis
- Database migrations instead of auto-sync
- Optimized connection pooling

## Security Features

- **JWT Authentication** - Token-based authentication with configurable expiration
- **Password Security** - Bcrypt hashing with strength requirements (min 8 chars, uppercase, lowercase, number)
- **Two-Factor Authentication** - TOTP-based 2FA support
- **Role-Based Access Control** - Granular permissions per role
- **Document-Level Access Control** - Users only see documents from their accessible companies
- **Activity Audit Trail** - Comprehensive logging of user actions
- **Rate Limiting** - Protection against brute force and API abuse
- **Helmet Security Headers** - Comprehensive security headers
- **CORS Protection** - Configurable allowed origins
- **Input Validation** - Express-validator for request validation

## Email Notification System

- **Multiple Provider Support** - SMTP, Mailtrap, Office 365, Resend, SMTP2Go
- **Per-Company Configuration** - Each company can have different email preferences
- **Primary Contact Assignment** - Companies can assign a primary contact user for notifications
- **Summary vs Individual Emails** - Configurable per company
- **Attachment Support** - PDF attachments in notifications
- **Template-Based Emails** - HTML email templates with theming
- **Rate Limiting** - Prevents SMTP blocks with configurable limits
- **Retry Logic** - Exponential backoff for failed deliveries
- **Email Logging** - Complete delivery history in EmailLog table

## Document Retention

- **Configurable Retention Periods** - Set per document type or globally
- **Automatic Cleanup** - Scheduled task removes expired documents
- **Retention Date Calculation** - Based on document creation or issue date
- **Expiring Soonest Filter** - View documents expiring soon
- **Hard Deletion** - Files and database records are permanently removed

## License

ISC

## Author

Built with React and Node.js

