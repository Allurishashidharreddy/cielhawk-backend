CielHawk Live Full-Stack Website

Live frontend:
Netlify static website

Live backend:
Render Node.js API

Database and media storage:
Azure Tables + Azure Blob Storage

Pages:
- index.html          Public landing page
- login.html          Advertiser login only
- register.html       Advertiser registration page
- advertiser.html     Advertiser dashboard
- admin-login.html    Private admin login
- admin.html          Admin dashboard
- player.html         TV player page
- invoice.html        Campaign invoice page
- styles.css          UI styling
- app.js              Shared helper functions
- config.js           Live backend API URL
- 404.html            Error page

Current production features:
- Real advertiser registration
- Real advertiser login
- Admin login separated from advertiser login
- Screens stored in Azure Tables
- Campaigns stored in Azure Tables
- Creative files stored in Azure Blob Storage
- Nearby screen discovery with maps
- Campaign booking flow
- Razorpay test payment integration
- Creative approval workflow
- Invoice page
- Admin revenue analytics
- Device heartbeat monitoring
- TV player with offline cache support

Important:
- No demo login access should be used.
- No secrets should be committed to GitHub.
- Environment variables must be stored only in .env locally and Render environment settings.
- Razorpay is currently in test mode.
- Switch Razorpay to live mode only after full testing and business verification.

Admin credentials:
Stored in environment variables:
ADMIN_EMAIL
ADMIN_PASSWORD

Backend environment variables required:
AZURE_STORAGE_ACCOUNT
AZURE_STORAGE_KEY
AZURE_STORAGE_CONNECTION_STRING
BLOB_CONTAINER
JWT_SECRET
ADMIN_EMAIL
ADMIN_PASSWORD
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET

Deployment:
- Push frontend/backend files to GitHub.
- Netlify auto-deploys frontend.
- Render auto-deploys backend.