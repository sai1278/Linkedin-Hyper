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

write('package.json', JSON.stringify({
  "name": "linkedin-chat-tracker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "postinstall": "prisma generate"
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
    "next-auth": "5.0.0-beta.16",
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
}, null, 2));

write('tsconfig.json', JSON.stringify({
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
    "plugins": [{"name": "next"}],
    "paths": {"@/*": ["./src/*"]}
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}, null, 2));

write('postcss.config.js', "module.exports = { plugins: { tailwindcss: {}, autoprefixer: {}, }, }");

write('tailwind.config.ts', 'import type { Config } from "tailwindcss";\nconst config: Config = {\n  content: ["./src/pages/**/*.{js,ts,jsx,tsx,mdx}","./src/components/**/*.{js,ts,jsx,tsx,mdx}","./src/app/**/*.{js,ts,jsx,tsx,mdx}"],\n  theme: {\n    extend: {\n      colors: {\n        brand: { DEFAULT: "#0EA5E9", dark: "#0369A1" },\n        surface: { DEFAULT: "#0F172A", elevated: "#1E293B", border: "#334155" },\n        text: { primary: "#F1F5F9", secondary: "#94A3B8", muted: "#475569" }\n      }\n    },\n  },\n  plugins: [],\n};\nexport default config;');

write('next.config.ts', "/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  images: {\n    remotePatterns: [\n      { hostname: 'media.licdn.com' },\n      { hostname: 'static.licdn.com' }\n    ]\n  }\n};\n\nexport default nextConfig;");

write('prisma/schema.prisma', 'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\nmodel User {\n  id        String   @id @default(cuid())\n  email     String   @unique\n  name      String?\n  password  String?\n  createdAt DateTime @default(now())\n  accounts  LinkedInAccount[]\n  templates MessageTemplate[]\n}\n\nmodel LinkedInAccount {\n  id                String   @id @default(cuid())\n  userId            String\n  user              User     @relation(fields: [userId], references: [id])\n  unipileAccountId  String   @unique\n  displayName       String\n  profilePicUrl     String?\n  status            AccountStatus @default(ACTIVE)\n  connectedAt       DateTime @default(now())\n  lastSyncAt        DateTime?\n  conversations     Conversation[]\n  activityLogs      ActivityLog[]\n}\n\nenum AccountStatus { ACTIVE\n DISCONNECTED\n ERROR }\n\nmodel Contact {\n  id            String  @id @default(cuid())\n  linkedinId    String\n  fullName      String\n  headline      String?\n  profileUrl    String\n  avatarUrl     String?\n  accountId     String\n  account       LinkedInAccount @relation(fields: [accountId], references: [id])\n  conversations Conversation[]\n  @@unique([linkedinId, accountId])\n}\n\nmodel Conversation {\n  id             String   @id @default(cuid())\n  accountId      String\n  account        LinkedInAccount @relation(fields: [accountId], references: [id])\n  contactId      String\n  contact        Contact  @relation(fields: [contactId], references: [id])\n  unipileChatId  String   @unique\n  lastMessageAt  DateTime?\n  unreadCount    Int      @default(0)\n  status         ConversationStatus @default(ACTIVE)\n  messages       Message[]\n  createdAt      DateTime @default(now())\n}\n\nenum ConversationStatus { ACTIVE\n ARCHIVED }\n\nmodel Message {\n  id                 String          @id @default(cuid())\n  conversationId     String\n  conversation       Conversation    @relation(fields: [conversationId], references: [id])\n  direction          MessageDirection\n  body               String\n  sentAt             DateTime\n  deliveryStatus     DeliveryStatus  @default(SENT)\n  isConnectionRequest Boolean        @default(false)\n  jobId              String?\n  createdAt          DateTime        @default(now())\n}\n\nenum MessageDirection { INBOUND\n OUTBOUND }\nenum DeliveryStatus   { SENT\n DELIVERED\n READ\n FAILED }\n\nmodel ActivityLog {\n  id          String          @id @default(cuid())\n  accountId   String\n  account     LinkedInAccount @relation(fields: [accountId], references: [id])\n  action      String\n  metadata    Json?\n  occurredAt  DateTime        @default(now())\n}\n\nmodel MessageTemplate {\n  id         String       @id @default(cuid())\n  userId     String\n  user       User         @relation(fields: [userId], references: [id])\n  name       String\n  type       TemplateType\n  body       String\n  variables  String[]\n  usageCount Int          @default(0)\n  createdAt  DateTime     @default(now())\n  updatedAt  DateTime     @updatedAt\n}\n\nenum TemplateType { MESSAGE\n CONNECTION_NOTE }');

write('.env.example', 'DATABASE_URL=postgresql://user:password@localhost:5432/linkedin_tracker\nNEXTAUTH_SECRET=\nNEXTAUTH_URL=http://localhost:3000\nUNIPILE_DSN=\nUNIPILE_ACCESS_TOKEN=\nUNIPILE_WEBHOOK_SECRET=\nGEMINI_API_KEY=\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=');

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
  let content = '// TODO: Implement stub for ' + file + '\\n';
  
  if (file === 'src/app/layout.tsx') {
    content += 'import "./globals.css";\\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\\n  return <html lang="en"><body>{children}</body></html>;\\n}\\n';
  } else if (file.endsWith('page.tsx')) {
    content += 'export default function Page() { return <div>Page stub: ' + file + '</div>; }\\n';
  } else if (file.endsWith('layout.tsx')) {
    content += 'export default function Layout({ children }: { children: React.ReactNode }) { return <div>{children}</div>; }\\n';
  } else if (file.endsWith('route.ts')) {
    content += "import { NextResponse } from 'next/server';\\nexport async function GET() { return NextResponse.json({ stub: true }); }\\n";
  } else if (file.endsWith('.tsx')) {
    content += 'export default function Component() { return <div>Component stub: ' + file + '</div>; }\\n';
  } else if (file.endsWith('.ts')) {
    content += 'export const stub = true;\\n';
  }
  
  write(file, content);
}

write('src/app/globals.css', '@tailwind base;\\n@tailwind components;\\n@tailwind utilities;\\n');
console.log('Scaffolding complete.');
