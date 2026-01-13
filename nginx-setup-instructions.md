# Nginx Setup Instructions - Step by Step

## Step 1: Backup Current Config

```bash
ssh rob@Makita-InvPortal-02

# Backup current config
sudo cp /etc/nginx/sites-available/makita-invportal /etc/nginx/sites-available/makita-invportal.backup

# Verify backup
ls -lh /etc/nginx/sites-available/makita-invportal*
```

## Step 2: Paste New Config (HTTP Only - No SSL Yet)

```bash
# Edit the config file
sudo nano /etc/nginx/sites-available/makita-invportal
```

**Delete everything and paste this (HTTP only, SSL will be added by certbot):**

```nginx
# Catch-all: drop random hosts hitting this IP
server {
    listen 80 default_server;
    server_name _;
    return 444;
}

# Makita Invoice Portal - HTTP (will redirect to HTTPS after SSL setup)
server {
    listen 80;
    server_name edi.makitauk.com dev-edi.makitauk.com;

    client_max_body_size 250m;

    # React build output
    root /var/www/makita-invportal/frontend/build;
    index index.html;

    # API -> Node (Express)
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # If you upload big PDFs / slow imports:
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # WebSocket support (only upgrades when requested)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }

    # Add proper MIME type for .mjs files
    location ~* \.mjs$ {
        types { application/javascript mjs; }
        add_header Content-Type application/javascript;
    }

    # Serve uploaded files (proxied to backend)
    location /uploads/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        expires 7d;
        add_header Cache-Control "public, max-age=604800";
    }

    # React SPA routes
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Map header for websocket Connection upgrade
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

**Save:** `Ctrl+O`, `Enter`, `Ctrl+X`

## Step 3: Test and Enable Config

```bash
# Test nginx configuration
sudo nginx -t

# If test passes, reload nginx
sudo systemctl reload nginx

# Check nginx status
sudo systemctl status nginx
```

## Step 4: Verify HTTP Works

Test that both domains work on HTTP:
- http://edi.makitauk.com
- http://dev-edi.makitauk.com

Both should load the frontend.

## Step 5: Install Certbot (if not already installed)

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
```

## Step 6: Get SSL Certificates

```bash
# Get SSL certificate for both domains
sudo certbot --nginx -d edi.makitauk.com -d dev-edi.makitauk.com
```

**Follow the prompts:**
1. Enter your email address (for renewal notices)
2. Agree to terms of service (type `A` and press Enter)
3. Choose whether to redirect HTTP to HTTPS: **Select option 2 (Redirect)** and press Enter

Certbot will:
- ✅ Obtain SSL certificates from Let's Encrypt
- ✅ Automatically update your nginx config with SSL settings
- ✅ Add HTTPS server block
- ✅ Set up HTTP to HTTPS redirect
- ✅ Configure auto-renewal

## Step 7: Verify SSL Works

Test that both domains work on HTTPS:
- https://edi.makitauk.com
- https://dev-edi.makitauk.com

HTTP should automatically redirect to HTTPS.

## Step 8: Verify Auto-Renewal

```bash
# Test renewal (dry run - won't actually renew)
sudo certbot renew --dry-run

# Check renewal timer status
sudo systemctl status certbot.timer
```

## Troubleshooting

### If nginx test fails:
```bash
# Check error details
sudo nginx -t

# View nginx error log
sudo tail -20 /var/log/nginx/error.log
```

### If certbot fails:
- Make sure both domains point to this server's IP in DNS
- Make sure port 80 is open: `sudo ufw allow 80/tcp`
- Make sure port 443 is open: `sudo ufw allow 443/tcp`

### To restore backup:
```bash
sudo cp /etc/nginx/sites-available/makita-invportal.backup /etc/nginx/sites-available/makita-invportal
sudo nginx -t
sudo systemctl reload nginx
```

## Final Result

After completing these steps, you'll have:
- ✅ HTTP (port 80) - redirects to HTTPS
- ✅ HTTPS (port 443) - with SSL certificates
- ✅ Both domains working: edi.makitauk.com and dev-edi.makitauk.com
- ✅ Auto-renewal of SSL certificates
- ✅ All existing functionality preserved
