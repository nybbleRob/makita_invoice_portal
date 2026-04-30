# reCAPTCHA v3 Setup (Login, Register, Forgot Password)

The app uses **Google reCAPTCHA v3** (invisible, score-based) on login, registration, and forgot-password. Follow these steps to fix "reCAPTCHA verification failed" and keep reCAPTCHA enabled.

## 1. Create reCAPTCHA v3 keys

1. Go to [Google reCAPTCHA Admin](https://www.google.com/recaptcha/admin).
2. Click **Create** (or use an existing v3 site).
3. **Label**: e.g. `Invoice Portal`.
4. **reCAPTCHA type**: choose **reCAPTCHA v3**.
5. **Domains**: add every origin where the frontend runs, for example:
   - `localhost` (development)
   - Your production domain, e.g. `portal.yourcompany.com`
   - No protocol, no path — just the hostname.
6. Accept the terms and submit.
7. Copy the **Site Key** and **Secret Key**. They must be from the same v3 site.

## 2. Backend (.env)

In the **backend** `.env` (e.g. `backend/.env`):

```env
RECAPTCHA_ENABLED=true
RECAPTCHA_SECRET_KEY=your-recaptcha-v3-secret-key-here
```

Use the **Secret key** from the reCAPTCHA admin (not the site key).

## 3. Frontend (.env)

In the **frontend** `.env` (e.g. `frontend/.env` or project root if your React app loads it):

```env
REACT_APP_RECAPTCHA_SITE_KEY=your-recaptcha-v3-site-key-here
```

Use the **Site key** from the reCAPTCHA admin. Restart the frontend dev server after changing.

## 4. Restart and test

- Restart the **backend** after changing `backend/.env`.
- Restart the **frontend** (e.g. `npm start`) after changing the frontend env so `REACT_APP_*` is picked up.
- Try login again. If it still fails, check the **backend console** for a line like:
  - `reCAPTCHA verification failed. Google error-codes: ...`
  That tells you whether the problem is e.g. wrong secret, wrong domain, or expired token.

## Troubleshooting

| Backend log / issue | Fix |
|---------------------|-----|
| `invalid-input-secret` | Backend `RECAPTCHA_SECRET_KEY` is wrong or from a different reCAPTCHA site. Use the Secret key from the same v3 site as the frontend site key. |
| `timeout-or-duplicate` | Token was already used or took too long. User should refresh the page and try again. |
| `missing-input-secret` | Backend `RECAPTCHA_SECRET_KEY` is empty or not set. |
| Score too low | reCAPTCHA v3 returns a score 0.0–1.0; default minimum is 0.5. If your users often get low scores (e.g. VPN, automation), you can lower the threshold in `backend/routes/auth.js` (and similar) where `recaptchaMiddleware({ minScore: 0.5 })` is used. |
| Domain / CORS | Ensure the **exact** domain (e.g. `localhost` or `portal.example.com`) is listed under Domains in the reCAPTCHA admin. |

To **disable** reCAPTCHA instead of fixing it, set in backend `.env`:

```env
RECAPTCHA_ENABLED=false
```

No frontend env vars are required when reCAPTCHA is disabled.
