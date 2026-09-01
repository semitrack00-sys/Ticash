````markdown
# TiCash - Haiti Remittance & Money Transfer Platform

**TiCash** is a secure, fast, and affordable remittance platform designed to connect Haitians worldwide with family and friends back home. Built with modern web, mobile, and backend technologies, TiCash bridges the gap between traditional money transfer services and digital-first financial technology.

---

## 🎯 Project Overview

### Mission
To provide Haitians with a safe, convenient, and cost-effective way to send money home using modern fintech infrastructure.

### Key Features
- **Fast Transfers:** Near-instant money transfers to MonCash, NatCash, and Digicel partners
- **Secure:** End-to-end encryption, biometric authentication, MFA, fraud detection
- **Affordable:** Competitive fees with transparent pricing
- **KYC/AML Compliant:** Full identity verification and compliance workflows
- **Multi-Currency:** USD, HTG, CAD, EUR support with real-time exchange rates
- **Payment Methods:** Stripe, PayPal, bank transfers, card payments
- **Admin Dashboard:** Compliance, transaction monitoring, user management

---

## 🏗️ Architecture & Technology Stack

### **Phase 1: Foundation (Current)**
Establishes core API, database schema, and web prototype for testing.

#### Backend
- **Runtime:** Node.js 20
- **Framework:** Express.js
- **Language:** TypeScript
- **Database:** PostgreSQL 16 (Alpine)
- **ORM:** Prisma
- **Validation:** Zod
- **Authentication:** JWT + OTP (SMS)
- **Testing:** Vitest
- **Linting:** ESLint + Prettier
- **Container:** Docker + Docker Compose

#### Frontend (Web Prototype)
- **Framework:** React/Expo (prototype for API validation)
- **Navigation:** React Navigation
- **State:** Zustand + React Query
- **Validation:** Zod
- **HTTP:** Axios
- **Styling:** React Native (cross-platform)
- **Build:** Expo CLI

#### Shared
- **Types:** TypeScript interfaces + Zod schemas
- **Package:** `@ticash/shared` (monorepo package)

#### DevOps
- **Containerization:** Docker & Docker Compose
- **CI/CD:** GitHub Actions (type-check, lint, test, build)
- **Environment:** Configurable via `.env`

### **Phase 2+: Mobile App (Planned)**
Production mobile app for App Store and Google Play.

#### Mobile (Production)
- **Framework:** Flutter
- **Target:** iOS + Android (single codebase)
- **Why Flutter:**
  - One codebase for both platforms
  - Native performance and UX
  - Strong security libraries (biometrics, secure storage)
  - Easy payment SDK integration
  - Faster iteration than native Swift/Kotlin

#### Native Integrations
- **Biometrics:** Touch/Face ID (iOS), Biometric API (Android)
- **Secure Storage:** Keychain (iOS), Keystore (Android)
- **Camera:** Native camera for ID verification
- **Push Notifications:** FCM (Android), APNs (iOS)
- **Payment SDKs:** Stripe, PayPal native modules
- **Device Integrity:** Play Integrity (Android), App Attest (iOS)

---

## 📊 Data Model (15 Core Entities)

```
User
├── Session
├── Recipient (saved payees)
├── Transfer (transaction history)
├── PaymentMethod
├── KYCData
├── NotificationPreference
└── Wallet

Transaction
├── TransactionFee
└── TransactionAuditLog

PaymentProvider
├── ProviderConfig
└── ProviderWebhook

FraudAlert
AuditLog
```

See `apps/api/prisma/schema.prisma` for full schema.

---

## 🔐 Security Architecture

### Authentication & Authorization
- **JWT Tokens:** Short-lived access + refresh tokens
- **OTP:** SMS-based one-time passwords for sensitive actions
- **Two-Factor Authentication (2FA):** Optional TOTP or SMS
- **Biometric Login:** Mobile app support (Flutter phase)

### Data Protection
- **Encryption in Transit:** TLS 1.3
- **Encryption at Rest:** Database-level encryption (PostgreSQL)
- **Secure Storage:** Encrypted token storage on mobile (Keychain/Keystore)
- **Rate Limiting:** Per-user and IP-based request throttling

### Compliance & Monitoring
- **KYC/AML:** Full identity verification workflow with BASIC & VERIFIED levels
- **Transaction Limits:** Per-user daily/monthly limits based on KYC status
- **Audit Logging:** Complete transaction and admin action logs
- **Fraud Detection:** Risk scoring, velocity checks, anomaly detection
- **Regulatory:** Designed for Haiti Central Bank and US FinCEN compliance

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- npm or yarn
- Git

### Development Setup

#### 1. Clone & Install
```bash
git clone https://github.com/semitrack00-sys/Ticash.git
cd Ticash
npm install
```

#### 2. Environment Variables
```bash
cp .env.example .env
# Edit .env with your config (see .env.example for all options)
```

#### 3. Start Services
```bash
# Start PostgreSQL + API via Docker Compose
docker-compose up -d

# Apply Prisma migrations
npx prisma migrate dev

# Seed database (optional)
npx prisma db seed
```

#### 4. Run API
```bash
cd apps/api
npm run dev
# API runs on http://localhost:4000
```

#### 5. Run Web Prototype (Optional)
```bash
cd apps/web
npm start
# Web app runs on http://localhost:8081
```

#### 6. Health Check
```bash
curl http://localhost:4000/health
# Expected: { "status": "ok", "timestamp": "2024-..." }
```

---

## 📁 Project Structure

```
Ticash/
├── apps/
│   ├── api/                    # Node.js/Express backend
│   │   ├── src/
│   │   │   ├── routes/         # API endpoints
│   │   │   ├── middleware/     # Auth, logging, error handling
│   │   │   ├── lib/            # Utilities, validation
│   │   │   ├── services/       # Business logic
│   │   │   └── index.ts        # Entry point
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Database schema
│   │   │   └── migrations/     # DB migrations
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                    # React/Expo web prototype
│       ├── src/
│       ├── app.json
│       └── package.json
│
├── packages/
│   └── shared/                 # Monorepo shared types & validation
│       └── src/
│           └── types/
│
├── docker-compose.yml          # Local dev services
├── .env.example                # Environment template
├── .gitignore
└── README.md                   # This file
```

---

## 🔌 API Endpoints (Phase 1)

### Health Check
```
GET /health
```

### Authentication (To Be Implemented)
```
POST /api/auth/register          # User signup
POST /api/auth/login             # User login
POST /api/auth/verify-otp        # Verify OTP code
POST /api/auth/2fa/enable        # Enable 2FA
POST /api/auth/2fa/verify        # Verify 2FA token
POST /api/auth/refresh           # Refresh access token
POST /api/auth/logout            # Logout
```

### Users (To Be Implemented)
```
GET  /api/users/profile          # Get user profile
PUT  /api/users/profile          # Update profile
POST /api/users/kyc              # Submit KYC data
GET  /api/users/kyc              # Get KYC status
```

### Recipients (To Be Implemented)
```
GET  /api/recipients             # List saved recipients
POST /api/recipients             # Add new recipient
PUT  /api/recipients/:id         # Update recipient
DELETE /api/recipients/:id       # Delete recipient
```

### Transfers (To Be Implemented)
```
POST /api/transfers              # Create transfer
GET  /api/transfers              # Get transfer history
GET  /api/transfers/:id          # Get transfer details
POST /api/transfers/:id/cancel   # Cancel transfer
```

### Admin (To Be Implemented)
```
GET  /api/admin/transactions     # View all transactions
GET  /api/admin/users            # Manage users
GET  /api/admin/compliance       # Compliance dashboard
POST /api/admin/fraud/alerts     # Fraud monitoring
```

---

## 🧪 Testing

### Run Tests
```bash
cd apps/api
npm run test:run
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

---

## 📦 Building for Production

### API
```bash
cd apps/api
npm run build
npm start
```

### Web
```bash
cd apps/web
npm run build:web
# Output in `dist/`
```

### Docker
```bash
docker build -f apps/api/Dockerfile -t ticash-api:latest .
docker run -p 4000:4000 --env-file .env ticash-api:latest
```

---

## 🔄 CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`):
1. **Type Check:** TypeScript compilation
2. **Lint:** ESLint + Prettier
3. **Test:** Vitest unit & integration tests
4. **Build:** Production build verification

Runs on:
- Push to `main`, `develop`, `phase-*` branches
- Pull requests to `main` or `develop`

---

## 💳 Payment Integrations

### Supported Providers
- **Stripe:** Credit/debit cards, bank transfers (US/international)
- **PayPal:** PayPal wallet, linked cards
- **MonCash:** Haiti mobile money (official partner)
- **NatCash:** Haiti mobile money (official partner)
- **Digicel:** Mobile wallet transfers

### Integration Status
- ✅ **Phase 1:** Mock providers for testing
- 🔄 **Phase 2:** Stripe + PayPal sandbox integration
- 🚀 **Phase 3:** Production MonCash/NatCash approval & deployment

---

## 🎓 Development Workflow

### Create Feature Branch
```bash
git checkout -b feature/user-authentication
```

### Make Changes & Commit
```bash
npm run format
npm run lint -- --fix
git add .
git commit -m "feat: add user authentication"
```

### Push & Create PR
```bash
git push origin feature/user-authentication
# Open PR on GitHub
```

### Code Review & Merge
```bash
# After approval:
git checkout develop
git merge feature/user-authentication
git push origin develop
```

---

## 📚 Documentation

- **API Documentation:** See `docs/API.md` (to be generated)
- **Database Schema:** See `apps/api/prisma/schema.prisma`
- **Environment Variables:** See `.env.example`
- **Security Guidelines:** See `docs/SECURITY.md` (to be created)
- **Compliance:** See `docs/COMPLIANCE.md` (to be created)

---

## 🐛 Troubleshooting

### Database Connection Error
```bash
# Check PostgreSQL is running
docker-compose ps

# Restart services
docker-compose restart postgres
```

### Port Already in Use
```bash
# Check processes on ports 4000 & 5432
lsof -i :4000
lsof -i :5432

# Kill process or use different port in .env
```

### Prisma Issues
```bash
# Regenerate Prisma client
npx prisma generate

# Reset database (careful!)
npx prisma migrate reset
```

---

## 📞 Support & Contact

- **Issues:** GitHub Issues
- **Discussions:** GitHub Discussions
- **Email:** support@ticash.app (when ready)
- **Twitter:** @TiCashApp (when ready)

---

## 📋 Roadmap

### Phase 1 ✅ (Current)
- [x] Project foundation & monorepo setup
- [x] API core (Express, Prisma, auth skeleton)
- [x] Database schema (15 core entities)
- [x] Docker & local development
- [x] Validation & error handling
- [x] Web prototype (Expo)
- [ ] API route implementations
- [ ] User authentication flow
- [ ] OTP & 2FA system

### Phase 2 🚀 (Q4 2024)
- Flutter mobile app (iOS + Android)
- Stripe & PayPal integration (sandbox)
- KYC/AML workflow
- Admin compliance dashboard
- Transaction monitoring & fraud detection
- Push notifications

### Phase 3 📈 (Q1 2025)
- MonCash & NatCash production approval
- Advanced fraud detection (ML models)
- Biometric authentication (mobile)
- Transaction analytics
- API rate limiting & caching
- Admin reporting

### Phase 4 🌐 (Q2+ 2025)
- International expansion (other Caribbean countries)
- Corporate/business accounts
- B2B partnerships
- Advanced KYC/AML features
- Open API for partners

---

## 📄 License

Proprietary — All rights reserved. TiCash © 2024

---

## 👥 Contributors

- **Founder:** semitrack00-sys
- **Contributors:** [See GitHub](https://github.com/semitrack00-sys/Ticash/graphs/contributors)

---

## ⚠️ Important Notes

### Security
- **Never commit `.env` files** with real credentials
- Always use environment variables for secrets
- Enable 2FA on GitHub account
- Keep dependencies updated (`npm audit`)

### Development
- Follow TypeScript strict mode
- Write tests for new features
- Format code before committing (`npm run format`)
- Keep commits atomic and descriptive

### Deployment
- Only deploy from `main` or tagged releases
- Test in staging before production
- Monitor logs and error rates post-deploy
- Keep database backups

---

**Last Updated:** September 2024
**Current Phase:** 1 - Foundation
**Status:** 🔄 In Development
````
