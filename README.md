# SaaS Template

A production-ready SaaS starter kit built with modern technologies. Ship your next SaaS product faster.

## Features

- **Authentication** - Email/password, social login (Google, GitHub), magic links, 2FA with [Better Auth](https://better-auth.com)
- **Multi-Tenancy** - Organizations, teams, invitations, and member management
- **Payments** - Subscription billing with [Polar.sh](https://polar.sh)
- **Admin Panel** - User management, audit logs, and system administration
- **AI Integration** - Multi-provider support (OpenAI, Anthropic, Google) with observability
- **Beautiful UI** - Dashboard with charts, tables, and widgets built with [shadcn/ui](https://ui.shadcn.com)
- **Background Jobs** - Task scheduling with [Trigger.dev](https://trigger.dev)
- **Email** - Transactional emails with [Resend](https://resend.com)
- **Type-Safe API** - End-to-end type safety with [tRPC](https://trpc.io)
- **Database** - PostgreSQL with [Drizzle ORM](https://orm.drizzle.team)

## Tech Stack

- **Frontend**: React 19, TanStack Router, TanStack Query
- **Backend**: Hono, tRPC
- **Database**: PostgreSQL, Drizzle ORM
- **Auth**: Better Auth
- **Payments**: Polar.sh
- **UI**: shadcn/ui, Tailwind CSS
- **Build**: Turborepo, Bun

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.3+)
- PostgreSQL database

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd memorystack
```

2. Install dependencies:
```bash
bun install
```

3. Copy the environment variables:
```bash
cp .env.example .env
```

4. Update the `.env` file with your credentials:
- Database URL
- Better Auth secret
- OAuth credentials (optional)
- Polar.sh credentials (optional)
- AI provider keys (optional)

5. Push the database schema:
```bash
bun run db:push
```

6. Start the development server:
```bash
bun run dev
```

The app will be available at:
- Web: http://localhost:3001
- API: http://localhost:3000

## Project Structure

```
├── apps/
│   ├── web/          # Frontend (React + TanStack Router)
│   └── server/       # Backend (Hono + tRPC)
├── packages/
│   ├── api/          # tRPC routers and procedures
│   ├── auth/         # Authentication configuration
│   ├── db/           # Database schema and migrations
│   ├── email/        # Email templates
│   ├── ai/           # AI provider configuration
│   └── env/          # Environment variable validation
```

## Available Scripts

```bash
# Development
bun run dev           # Start all apps in dev mode
bun run dev:web       # Start only the web app
bun run dev:server    # Start only the server

# Database
bun run db:push       # Push schema changes
bun run db:studio     # Open Drizzle Studio
bun run db:generate   # Generate migrations
bun run db:migrate    # Run migrations

# Build
bun run build         # Build all apps
bun run check-types   # Type check all packages

# Docker
bun run docker:dev    # Start development containers
bun run docker:up     # Start production containers
```

## Admin Access

To access the admin panel, set your user's role to `admin` in the database:

```sql
UPDATE "user" SET role = 'admin' WHERE email = 'your-email@example.com';
```

Then navigate to `/admin`.

## Environment Variables

See `.env.example` for all available configuration options.

### Required
- `DATABASE_URL` - PostgreSQL connection string
- `BETTER_AUTH_SECRET` - Secret for session encryption
- `CORS_ORIGIN` - Frontend URL

### Optional
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - Google OAuth
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` - GitHub OAuth
- `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET` - Payments
- `RESEND_API_KEY` - Transactional emails
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` - AI providers

## Deployment

### Docker

```bash
docker-compose up -d
```

### Manual

1. Build the apps:
```bash
bun run build
```

2. Start the server:
```bash
bun run start
```

## License

MIT
