# Project Structure

## Directory Organization

```
ticash/
├── src/
│   ├── components/     # Reusable UI components
│   ├── pages/          # Page components
│   ├── services/       # API and external services
│   ├── utils/          # Utility functions
│   ├── hooks/          # Custom React hooks
│   ├── types/          # TypeScript type definitions
│   ├── store/          # State management
│   ├── middleware/     # Express/API middleware
│   └── constants/      # Application constants
├── public/             # Static assets
├── config/             # Configuration files
├── tests/              # Test files
├── docs/               # Documentation
├── package.json
├── tsconfig.json
└── docker-compose.yml
```

## Folder Descriptions

### `src/components/`
Reusable UI components like buttons, forms, modals, etc.

### `src/pages/`
Page-level components (home, login, send, verify)

### `src/services/`
API calls and external service integrations

### `src/utils/`
Utility functions (colors, helpers, etc.)

### `src/types/`
Shared TypeScript interfaces and types

### `src/hooks/`
Custom React hooks for business logic

### `src/store/`
State management (Redux, Zustand, etc.)

### `src/middleware/`
Express middleware, authentication, validation

### `src/constants/`
Application-wide constants and config values

### `public/`
Static assets (images, logos, icons)

### `config/`
Application configuration

### `tests/`
Unit and integration tests
