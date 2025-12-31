/**
 * PM2 Ecosystem Configuration
 * Manages Node.js processes for the Invoice Portal
 * 
 * Usage:
 *   pm2 start ecosystem.config.js          # Start all processes
 *   pm2 start ecosystem.config.js --only backend  # Start only backend
 *   pm2 stop all                           # Stop all processes
 *   pm2 logs                                # View logs
 *   pm2 monit                               # Monitor processes
 */

module.exports = {
  apps: [
    {
      name: 'invoice-portal-backend',
      script: './backend/server.js',
      cwd: './backend',
      instances: 1,
      exec_mode: 'fork',
      watch: false, // Set to true for auto-restart on file changes (development)
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      error_file: './logs/pm2-backend-error.log',
      out_file: './logs/pm2-backend-out.log',
      log_file: './logs/pm2-backend-combined.log',
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      // Wait for graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true
    },
    {
      name: 'invoice-portal-queue-worker',
      script: './workers/queueWorker.js',
      cwd: './backend',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-queue-error.log',
      out_file: './logs/pm2-queue-out.log',
      log_file: './logs/pm2-queue-combined.log',
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      kill_timeout: 10000
    },
    {
      name: 'invoice-portal-scheduler',
      script: './workers/scheduler.js',
      cwd: './backend',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'development',
        TZ: 'UTC'
      },
      env_production: {
        NODE_ENV: 'production',
        TZ: 'UTC'
      },
      error_file: './logs/pm2-scheduler-error.log',
      out_file: './logs/pm2-scheduler-out.log',
      log_file: './logs/pm2-scheduler-combined.log',
      time: true,
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      kill_timeout: 5000
    }
  ]
};

