const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, 'linkedin-chat-tracker');
if (!fs.existsSync(projectRoot)) {
  fs.mkdirSync(projectRoot, { recursive: true });
}

function write(p, content) {
  const fullPath = path.join(projectRoot, p);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content.trim() + '\n');
}

// 1. package.json
write('package.json', `
{
  "name": "linkedin-chat-tracker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.3.4",
    "@prisma/client": "^5.11.0",
    "@radix-ui/react-avatar": "^1.0.4",
    "@radix-ui/react-badge": "^1.0.0",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-popover": "^1.0.7",
    "@radix-ui/react-tabs": "^1.0.4",
    "@radix-ui/react-tooltip": "^1.0.7",
    "@tanstack/react-query": "^5.28.4",
    "axios": "^1.6.8",
    "bcryptjs": "^2.4.3",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "date-fns": "^3.6.0",
    "lucide-react": "^0.359.0",
    "next": "14.1.4",
    "next-auth": "^5.0.0-beta.16",
    "papaparse": "^5.4.1",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "react-hook-form": "^7.51.1",
    "recharts": "^2.12.3",
    "sonner": "^1.4.3",
    "tailwind-merge": "^2.2.2",
    "zod": "^3.22.4",
    "zustand": "^4.5.2"
  },
  "devDependencies": {
    "@tanstack/react-query-devtools": "^5.28.4",
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20",
    "@types/papaparse": "^5.3.14",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "prisma": "^5.11.0",
    "tailwindcss": "^3.4.1",
    "typescript": "^5"
  }
}
`);

// 2. tsconfig.json
write('tsconfig.json', `
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`);

// postcss.config.js
write('postcss.config.js', `
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`);

// 3. tailwind.config.ts
write('tailwind.config.ts', `
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0EA5E9', dark: '#0369A1' },
        surface: { DEFAULT: '#0F172A', elevated: '#1E293B', border: '#334155' },
        text: { primary: '#F1F5F9', secondary: '#94A3B8', muted: '#475569' }
      }
    },
  },
  plugins: [],
};
export default config;
`);

// 4. next.config.ts (using mjs or js for next 14 usually, but ts requested)
write('next.config.mjs', `
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { hostname: 'media.licdn.com' },
      { hostname: 'static.licdn.com' }
    ]
  }
};

export default nextConfig;
`);

// 5. prisma/schema.prisma
write('prisma/schema.prisma', `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  password  String?
  createdAt DateTime @default(now())
  accounts  LinkedInAccount[]
  templates MessageTemplate[]
}

model LinkedInAccount {
  id                String   @id @default(cuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id])
  unipileAccountId  String   @unique
  displayName       String
  profilePicUrl     String?
  status            AccountStatus @default(ACTIVE)
  connectedAt       DateTime @default(now())
  lastSyncAt        DateTime?
  conversations     Conversation[]
  activityLogs      ActivityLog[]
}

enum AccountStatus { ACTIVE, DISCONNECTED, ERROR }

model Contact {
  id            String  @id @default(cuid())
  linkedinId    String
  fullName      String
  headline      String?
  profileUrl    String
  avatarUrl     String?
  accountId     String
  account       LinkedInAccount @relation(fields: [accountId], references: [id])
  conversations Conversation[]
  @@unique([linkedinId, accountId])
}

model Conversation {
  id             String   @id @default(cuid())
  accountId      String
  account        LinkedInAccount @relation(fields: [accountId], references: [id])
  contactId      String
  contact        Contact  @relation(fields: [contactId], references: [id])
  unipileChatId  String   @unique
  lastMessageAt  DateTime?
  unreadCount    Int      @default(0)
  status         ConversationStatus @default(ACTIVE)
  messages       Message[]
  createdAt      DateTime @default(now())
}

enum ConversationStatus { ACTIVE, ARCHIVED }

model Message {
  id                 String          @id @default(cuid())
  conversationId     String
  conversation       Conversation    @relation(fields: [conversationId], references: [id])
  direction          MessageDirection
  body               String
  sentAt             DateTime
  deliveryStatus     DeliveryStatus  @default(SENT)
  isConnectionRequest Boolean        @default(false)
  jobId              String?
  createdAt          DateTime        @default(now())
}

enum MessageDirection { INBOUND, OUTBOUND }
enum DeliveryStatus   { SENT, DELIVERED, READ, FAILED }

model ActivityLog {
  id          String          @id @default(cuid())
  accountId   String
  account     LinkedInAccount @relation(fields: [accountId], references: [id])
  action      String
  metadata    Json?
  occurredAt  DateTime        @default(now())
}

model MessageTemplate {
  id         String       @id @default(cuid())
  userId     String
  user       User         @relation(fields: [userId], references: [id])
  name       String
  type       TemplateType
  body       String
  variables  String[]
  usageCount Int          @default(0)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt
}

enum TemplateType { MESSAGE, CONNECTION_NOTE }
`);

// 6. .env.example
write('.env.example', `
DATABASE_URL=postgresql://user:password@localhost:5432/linkedin_tracker
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
UNIPILE_DSN=
UNIPILE_ACCESS_TOKEN=
UNIPILE_WEBHOOK_SECRET=
GEMINI_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
`);

// 7. Full /src directory stubs
const filesToStub = [
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/app/error.tsx',
  'src/app/global-error.tsx',
  'src/app/(auth)/login/page.tsx',
  'src/app/(dashboard)/layout.tsx',
  'src/app/(dashboard)/dashboard/page.tsx',
  'src/app/(dashboard)/accounts/page.tsx',
  'src/app/(dashboard)/accounts/[accountId]/page.tsx',
  'src/app/(dashboard)/conversations/page.tsx',
  'src/app/(dashboard)/conversations/[conversationId]/page.tsx',
  'src/app/(dashboard)/analytics/page.tsx',
  'src/app/(dashboard)/compose/page.tsx',
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/auth/register/route.ts',
  'src/app/api/accounts/route.ts',
  'src/app/api/accounts/[id]/route.ts',
  'src/app/api/conversations/route.ts',
  'src/app/api/conversations/[id]/messages/route.ts',
  'src/app/api/messages/send/route.ts',
  'src/app/api/messages/generate-note/route.ts',
  'src/app/api/messages/templates/route.ts',
  'src/app/api/connect/send/route.ts',
  'src/app/api/webhooks/unipile/route.ts',
  'src/app/api/analytics/[accountId]/route.ts',
  'src/app/api/people/search/route.ts',
  'src/components/ui/skeleton.tsx',
  'src/components/layout/Sidebar.tsx',
  'src/components/layout/TopBar.tsx',
  'src/components/accounts/AccountCard.tsx',
  'src/components/accounts/AccountConnectModal.tsx',
  'src/components/conversations/ConversationList.tsx',
  'src/components/conversations/MessageThread.tsx',
  'src/components/conversations/ComposeBox.tsx',
  'src/components/analytics/StatsCard.tsx',
  'src/components/analytics/ActivityChart.tsx',
  'src/components/analytics/FunnelChart.tsx',
  'src/components/compose/TemplateLibrary.tsx',
  'src/components/compose/BulkSendPanel.tsx',
  'src/components/compose/PeopleSearch.tsx',
  'src/lib/prisma.ts',
  'src/lib/unipile.ts',
  'src/lib/auth.ts',
  'src/lib/utils.ts',
  'src/types/index.ts',
  'src/types/unipile.ts',
  'src/hooks/useAccounts.ts',
  'src/hooks/useConversations.ts',
  'src/hooks/useMessages.ts',
  'src/hooks/useAnalytics.ts',
  'src/store/accountStore.ts',
  'src/store/uiStore.ts',
];

for (const file of filesToStub) {
  let content = \`// TODO: Implement stub for \${file}\n\`;
  
  if (file === 'src/app/layout.tsx') {
    content += \`import "./globals.css";
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
\`;
  } else if (file.endsWith('page.tsx')) {
    content += \`export default function Page() { return <div>Page stub: \${file}</div>; }\n\`;
  } else if (file.endsWith('layout.tsx')) {
    content += \`export default function Layout({ children }: { children: React.ReactNode }) { return <div>{children}</div>; }\n\`;
  } else if (file.endsWith('route.ts')) {
    content += \`import { NextResponse } from 'next/server';\nexport async function GET() { return NextResponse.json({ stub: true }); }\n\`;
  } else if (file.endsWith('.tsx')) {
    content += \`export default function Component() { return <div>Component stub: \${file}</div>; }\n\`;
  } else if (file.endsWith('.ts')) {
    content += \`export const stub = true;\n\`;
  }
  
  write(file, content);
}

write('src/app/globals.css', \`
@tailwind base;
@tailwind components;
@tailwind utilities;
\`);

console.log('Scaffolding complete.');
