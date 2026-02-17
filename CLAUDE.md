# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 15 application with Supabase authentication, built on the official Next.js + Supabase starter kit. It uses the App Router, React 19, TypeScript, Tailwind CSS, and shadcn/ui components.

## Commands

```bash
npm run dev      # Start development server (localhost:3000)
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Architecture

### Supabase Client Pattern

This project uses `@supabase/ssr` with separate client factories for different rendering contexts:

- **`lib/supabase/client.ts`** - Browser client for Client Components
- **`lib/supabase/server.ts`** - Server client for Server Components, Route Handlers, and Server Actions (must call `await createClient()` within each function)
- **`lib/supabase/proxy.ts`** - Middleware helper for session management and route protection

**Important**: Never store Supabase clients in global variables, especially with Vercel Fluid compute. Always create new instances per request/function.

### Authentication Flow

1. Auth pages live in `app/auth/` (login, sign-up, forgot-password, update-password, error)
2. Protected routes are under `app/protected/`
3. The middleware (`proxy.ts`) intercepts all requests, checks for valid sessions via `getClaims()`, and redirects unauthenticated users to `/auth/login`
4. Cookie-based SSR auth keeps sessions in sync across client and server

### Middleware Response Pattern

When modifying the middleware response, you must:
1. Pass the request object to `NextResponse.next({ request })`
2. Copy cookies from the original response
3. Return the modified response

Incorrect handling can cause users to be randomly logged out.

### UI Components

- shadcn/ui components are in `components/ui/` (New York style)
- Uses Radix UI primitives with Tailwind CSS styling
- Theme switching via `next-themes` with class-based dark mode
- CSS variables in `app/globals.css` define the color scheme

## Environment Variables

Required in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=<project-url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon-or-publishable-key>
```

Both values come from the Supabase project dashboard under API settings.
