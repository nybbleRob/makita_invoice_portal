/**
 * Storage Setup Documentation
 * ===========================
 * 
 * This file documents the environment variables and server setup
 * required for the Invoice Portal file storage system.
 * 
 * ENVIRONMENT VARIABLES
 * =====================
 * 
 * Add these to your backend/.env file:
 * 
 * DATA_DRIVE_PATH=/mnt/data
 * FTP_UPLOAD_PATH=/mnt/data/invoice-portal/uploads
 * UNPROCESSED_PATH=/mnt/data/unprocessed
 * PROCESSED_PATH=/mnt/data/processed
 * FILE_STORAGE_PATH=/mnt/data/invoice-portal
 * 
 * 
 * FOLDER STRUCTURE
 * ================
 * 
 * /mnt/data/
 * ├── invoice-portal/
 * │   └── uploads/              <- SFTP users upload here (chroot target)
 * ├── unprocessed/
 * │   ├── duplicates/           <- Duplicate files detected by hash
 * │   │   └── YYYY-MM-DD/
 * │   └── failed/               <- Failed parsing or allocation
 * │       └── YYYY-MM-DD/
 * ├── processed/
 * │   ├── invoices/
 * │   │   └── YYYY/MM/DD/
 * │   ├── creditnotes/
 * │   │   └── YYYY/MM/DD/
 * │   └── statements/
 * │       └── YYYY/MM/DD/
 * 
 * 
 * SERVER SETUP COMMANDS
 * =====================
 * 
 * Run these commands on your Linux server:
 * 
 * # Create folder structure
 * sudo mkdir -p /mnt/data/invoice-portal/uploads
 * sudo mkdir -p /mnt/data/unprocessed/duplicates
 * sudo mkdir -p /mnt/data/unprocessed/failed
 * sudo mkdir -p /mnt/data/processed/invoices
 * sudo mkdir -p /mnt/data/processed/creditnotes
 * sudo mkdir -p /mnt/data/processed/statements
 * 
 * # Set ownership (rob owns everything, makita_ftp can write to uploads)
 * sudo chown -R rob:rob /mnt/data/unprocessed
 * sudo chown -R rob:rob /mnt/data/processed
 * 
 * # SFTP chroot requires parent to be root-owned
 * sudo chown root:root /mnt/data/invoice-portal
 * sudo chown makita_ftp:rob /mnt/data/invoice-portal/uploads
 * sudo chmod 775 /mnt/data/invoice-portal/uploads
 * sudo chmod g+s /mnt/data/invoice-portal/uploads
 * 
 * # Add rob to makita_ftp group for file access
 * sudo usermod -aG makita_ftp rob
 * 
 * # Update SFTP config (/etc/ssh/sshd_config):
 * # Match User makita_ftp
 * #   ChrootDirectory /mnt/data/invoice-portal
 * #   ForceCommand internal-sftp
 * #   AllowTcpForwarding no
 * #   X11Forwarding no
 * 
 * # Restart services
 * sudo systemctl restart ssh
 * pm2 restart all
 * 
 * 
 * PROCESSING FLOW
 * ===============
 * 
 * 1. Files uploaded via SFTP go to: /mnt/data/invoice-portal/uploads/
 * 
 * 2. Scheduler scans uploads folder:
 *    - Calculates file hash
 *    - If duplicate (hash exists in DB) → moves to /mnt/data/unprocessed/duplicates/
 *    - If new → queues for processing
 * 
 * 3. Invoice import job processes file:
 *    - Parses PDF/Excel
 *    - Matches to company by account number
 *    - If successful → moves to /mnt/data/processed/{type}/YYYY/MM/DD/
 *    - If failed → moves to /mnt/data/unprocessed/failed/YYYY-MM-DD/
 * 
 * 4. Manual "Attempt Allocation" from unallocated view:
 *    - If successful → moves file to processed folder
 *    - Updates database records
 * 
 * 5. Retention cleanup (scheduled):
 *    - HARD DELETES files past retention period
 *    - Removes database records completely
 *    - No orphaned references
 * 
 * 
 * PRIORITY PROCESSING
 * ===================
 * 
 * - Manual uploads from dashboard: priority = 1 (high)
 * - FTP/scheduled imports: priority = 0 (normal)
 * 
 * Manual uploads are processed immediately before scheduled imports.
 * 
 * 
 * BATCH NOTIFICATIONS
 * ===================
 * 
 * After all files in an import batch are processed:
 * - Email notifications are queued for company contacts
 * - Summary or individual emails based on user preferences
 * - Only sent after entire batch completes
 * 
 */

// Export nothing - this is documentation only
module.exports = {};

