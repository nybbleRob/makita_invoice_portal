# Nginx Configuration Reference

## Troubleshooting "Virtual host not found"

This error means nginx doesn't have a `server_name` matching the domain you're accessing.

## Diagnostic Commands (Run on Server)

```bash
# SSH to server
ssh rob@Makita-InvPortal-02

# Check nginx status
sudo systemctl status nginx

# List all nginx config files
sudo ls -la /etc/nginx/sites-available/
sudo ls -la /etc/nginx/sites-enabled/

# View main nginx config
sudo cat /etc/nginx/nginx.conf

# View enabled site configs
sudo cat /etc/nginx/sites-enabled/*

# Test nginx configuration
sudo nginx -t

# Check nginx error logs
sudo tail -f /var/log/nginx/error.log
```

## Example Nginx Configuration

Here's what a typical configuration should look like for the Invoice Portal:

```nginx
server {
    listen 80;
    server_name edi.makitauk.com dev-edi.makitauk.com;  # Add both domains here
    
    # Redirect HTTP to HTTPS (if using SSL)
    # return 301 https://$server_name$request_uri;
    
    # Or serve directly on HTTP (for dev)
    root /var/www/makita-invportal/frontend/build;
    index index.html;
    
    # Serve static files
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Proxy API requests to Node.js backend
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

## Fixing the Issue

### Option 1: Add domain to existing config

If you have an existing config file:

```bash
# Edit the config
sudo nano /etc/nginx/sites-available/invoice-portal
# or
sudo nano /etc/nginx/sites-available/default

# Add your domain to server_name:
server_name edi.makitauk.com dev-edi.makitauk.com;

# Test the config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### Option 2: Create new config file

```bash
# Create new config
sudo nano /etc/nginx/sites-available/invoice-portal

# Paste the example config above, adjusting:
# - server_name to your domain(s)
# - root path to your frontend build directory

# Enable the site
sudo ln -s /etc/nginx/sites-available/invoice-portal /etc/nginx/sites-enabled/

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

## Common Issues

1. **Domain not in server_name**: Add it to the `server_name` directive
2. **Config not enabled**: Ensure symlink exists in `sites-enabled/`
3. **Nginx not running**: `sudo systemctl start nginx`
4. **DNS not pointing to server**: Check DNS records for your domain
5. **Port 80/443 blocked**: Check firewall rules

## SSL/HTTPS Setup

### Step 1: Install Certbot

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
```

### Step 2: Get SSL Certificate

```bash
# Get certificate for both domains
sudo certbot --nginx -d edi.makitauk.com -d dev-edi.makitauk.com

# Follow the prompts:
# - Enter email for renewal notices
# - Agree to terms
# - Choose whether to redirect HTTP to HTTPS (recommended: Yes)
```

Certbot will automatically:
- Obtain SSL certificates from Let's Encrypt
- Update your nginx config with SSL settings
- Set up auto-renewal

### Step 3: Verify Auto-Renewal

```bash
# Test renewal (dry run)
sudo certbot renew --dry-run

# Check renewal timer
sudo systemctl status certbot.timer
```

### Step 4: Manual Config (if not using certbot)

If you have existing certificates or want to configure manually, use the `makita-invportal-nginx.conf` file in the repo root, which includes:
- HTTP to HTTPS redirect
- Full SSL configuration
- Both domains (edi.makitauk.com and dev-edi.makitauk.com)
- Security headers
- WebSocket support

Then:

```bash
# Backup current config
sudo cp /etc/nginx/sites-available/makita-invportal /etc/nginx/sites-available/makita-invportal.backup

# Copy new config (adjust paths as needed)
sudo nano /etc/nginx/sites-available/makita-invportal
# Paste the config from makita-invportal-nginx.conf

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```
