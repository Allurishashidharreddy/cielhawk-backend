CielHawk Premium Azure Website

Upload all files into Azure Storage static website container: $web

Pages:
- index.html       Premium landing page
- login.html       Login page with demo admin/advertiser access
- register.html    Advertiser registration page
- advertiser.html  Advertiser dashboard
- admin.html       Admin dashboard
- player.html      TV player page
- styles.css       Premium UI styling
- app.js           Shared helper functions
- config.js        API backend URL
- 404.html         Error page

Demo login:
Admin: admin@cielhawk.com / admin123
Advertiser: brand@demo.com / demo123

Note:
This is a premium frontend. It still uses localStorage demo data until Azure App Service backend is created.
Next step: build Node.js backend APIs connected to Azure Blob Storage + Azure Tables.

Update in this version:
- Admin can edit screens
- Admin can delete screens
- Admin can approve/reject ads
- Admin can manually edit ad status
- Admin can delete ads
- Advertiser can edit demo campaign title/goal
- Advertiser can delete demo campaigns

Upload all files to Azure Storage static website container: $web