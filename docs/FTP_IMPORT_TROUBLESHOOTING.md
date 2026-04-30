# FTP / Local folder import troubleshooting

## What the logs showed

From `pm2-queue-out.log`, the scheduled **local-folder-scan** is running and scanning:

- **Path:** `/mnt/data/invoice-portal/uploads`
- **Result:** Directory exists, but **0 files/dirs** in the folder

So the scanner is working; the folder it’s watching is empty.

---

## 1. Why “FTP” isn’t importing

The app doesn’t run an FTP server. “FTP import” is a **local folder scan**: a job runs on a schedule and looks for files in one directory. SFTP/FTP users must drop files into that same path (e.g. via chroot or mount).

So if nothing is importing, either:

- **Timing**: The scan runs **on the hour** (e.g. 08:00, 09:00). If files land at 08:28, the 08:00 run already passed; the **next** run (09:00) will see them. Check the next hour’s queue log to confirm.
- **Process can’t read the folder**: When you run `ls` as `rob` you see files, but the **queue worker** runs as the PM2 process user. If that user can’t read the directory, `readdirSync` can return 0 entries. Ensure PM2 runs as a user that can read `/mnt/data/invoice-portal/uploads` (e.g. same user as `rob`, or add the process user to group `rob`).
- Files are not being written into `/mnt/data/invoice-portal/uploads`, or  
- They’re only in **subfolders** (see below).

### Checks on the server

1. **Confirm path and env**
   - Scanner path comes from `FTP_UPLOAD_PATH` or default `$DATA_DRIVE_PATH/invoice-portal/uploads` (e.g. `/mnt/data/invoice-portal/uploads`).
   - On the server, ensure `.env` has the path you intend (if you use a custom path).

2. **Confirm where SFTP actually writes**
   - Check your SFTP server config (e.g. `sshd_config`, chroot, internal-sftp).
   - Ensure the chroot or upload directory is exactly the same as `FTP_UPLOAD_PATH` (e.g. `/mnt/data/invoice-portal/uploads`).
   - From the app server, list the directory:
     ```bash
     ls -la /mnt/data/invoice-portal/uploads
     ```
   - If you see files here but the app still reports 0, check that the process user (e.g. `rob`) can read the directory and files (permissions / ownership).

3. **Subfolders are not scanned**
   - The scanner only reads the **top level** of the upload folder (no recursion).
   - If users upload into subdirs (e.g. `uploads/2026/` or `uploads/SupplierA/`), those files are **never** seen.
   - Options:
     - Have users upload **only** in the root of the upload folder, or  
     - Change the app to scan subdirectories (code change in `backend/jobs/localFolderScanner.js`).

4. **Supported types**
   - Only these extensions are picked up: `.pdf`, `.xlsx`, `.xls`. Other types are ignored.

5. **File age**
   - Files newer than 30 seconds are skipped (to avoid half-uploaded files). So very recent uploads may appear in the next run.

---

## 2. Other issues from your logs (fixed in code)

These were in `pm2-queue-error.log` and can block or confuse behaviour:

- **Redis not running** (`ECONNREFUSED 127.0.0.1:6379`)  
  - Scheduler/queue may not run or may misbehave. Start Redis or remove `REDIS_HOST` from `.env` if you don’t use it.

- **`column File.invoiceId does not exist`**  
  - The document retention job was using columns that don’t exist on your `File` model. This is fixed: orphan cleanup now uses `Invoice`/`CreditNote`/`Statement`.`fileUrl` to decide if a file is still in use.

- **`column User.deletedAt does not exist`**  
  - The admin notification for retention cleanup was filtering on `User.deletedAt`. Your `User` model has no `deletedAt`. This is fixed: the job now uses `isActive: true` instead.

After pulling the fixes, redeploy and run the retention/cleanup jobs again; those errors should stop.

---

## 3. Quick checklist

| Check | Action |
|-------|--------|
| Path | `FTP_UPLOAD_PATH` (or default) = path SFTP actually writes to |
| Listing | `ls -la /mnt/data/invoice-portal/uploads` shows files when you expect them |
| Permissions | App process user can read the directory and files |
| Subfolders | Files are in the **root** of that folder, not in subdirs |
| File types | Only `.pdf`, `.xlsx`, `.xls` are imported |
| Redis | Running if you use queue/scheduler, or Redis disabled in `.env` |

---

## 4. Two different “import finished” emails

| Email | Subject / description | Who receives it | When it’s sent |
|-------|------------------------|------------------|----------------|
| **Document Import Completed** | “Document Import Completed - X file(s) processed” | **Settings → System email** (e.g. creditteam@makitauk.com) | Only when an **import store** session completes (e.g. **manual** upload from the UI). **Not sent for FTP imports** because FTP batches don’t create an import store session. |
| **Import Summary** | “Import Summary: X of Y documents processed” | **Each admin with “Receive Import Summary Reports” enabled** (e.g. rob@nybble.co.uk) | When a **batch** completes and batch data is in Redis (batch notification service). Used for **FTP and manual** batches. If the batch is missing in Redis when the last job finishes, this email is **not** sent. |

So if you see “Document Import Completed” in the email log to creditteam, that’s the **system email** path (manual uploads). The one you’re not getting to **rob@nybble.co.uk** is the **Import Summary**; that’s sent by the same queue worker when the batch completes, but only if the batch was still in Redis.

**Who sends the emails?** The **PM2 queue worker** (`invoice-portal-queue-worker`) sends them when it processes completed import jobs and runs the notification code. The **PM2 scheduler** only triggers the hourly scan (and other cron jobs); it does not send the import summary.

---

## 5. Import summary email – did it leave the system?

After each import batch completes, the system sends an **Import Summary** email to all Global Admins / Administrators who have **Receive Import Summary Reports** enabled (Edit User → Email Notifications).

To see whether the email was sent or why it wasn’t:

**On the queue worker log** (`pm2-queue-out.log` or `pm2-queue-error.log`):

- **Batch missing (summary never sent):**
  - `CRITICAL: Batch not found in Redis! Notifications will NOT be sent.`
  - `Import summary email will NOT be sent (batch data missing - check Redis or batch TTL).`
  - Cause: Redis didn’t have the batch when the last job completed (e.g. Redis restarted, or batch TTL expired before the batch finished).

- **Summary sent successfully:**
  - `sendBatchNotifications: starting (admin import summary will be sent to opted-in admins)`
  - `Sending import summary email to N recipient(s): you@example.com`
  - `Import summary email sent successfully to you@example.com`

- **Summary attempted but failed:**
  - `Import summary email FAILED to you@example.com: <error message>`

**Grep examples:**

```bash
# Did any import summary email get sent?
grep "Import summary email sent successfully" /var/www/makita-invportal/backend/logs/pm2-queue-out.log

# Was the batch missing so no email was sent?
grep "Batch not found in Redis\|Import summary email will NOT be sent" /var/www/makita-invportal/backend/logs/pm2-queue-error.log
```

---

## 6. Optional: scan subdirectories

If you need to support subfolders under the upload path, the scanner in `backend/jobs/localFolderScanner.js` would need to be updated to walk the directory tree (e.g. `fs.readdirSync` with recursion or a glob) and pass full relative paths into the existing queue logic.
