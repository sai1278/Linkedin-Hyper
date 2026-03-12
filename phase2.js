const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, 'linkedin-chat-tracker');

function write(p, content) {
  const full = path.join(root, p);
  fs.mkdirSync(path.dirname(full), {recursive: true});
  fs.writeFileSync(full, content.trim() + '\n');
}

write('src/types/unipile.ts', `
export interface UnipileAccount { id: string; provider: string; name: string; avatar_url: string; status: string; created_at: string; }
export interface UnipileParticipant { id: string; name: string; headline: string; avatar_url: string; profile_url: string; }
export interface UnipileAttachment { id: string; type: string; url: string; name: string; }
export interface UnipileMessage { id: string; chat_id: string; sender_id: string; text: string; created_at: string; is_read: boolean; attachments: UnipileAttachment[]; }
export interface UnipileChat { id: string; account_id: string; participants: UnipileParticipant[]; unread_count: number; last_message: UnipileMessage; created_at: string; }
export interface UnipileProfile { id: string; name: string; headline: string; location: string; about: string; avatar_url: string; profile_url: string; company: string; connections_count: number; }
export interface UnipileConnection { id: string; relation_id: string; profile: UnipileProfile; connected_at: string; }
export interface AuthLinkParams { success_redirect_url: string; failure_redirect_url: string; name: string; providers: string[]; }
export interface UnipileError { message: string; status: number; code?: string; }
export interface Paginated<T> { items: T[]; cursor: string | null; has_more: boolean; }
export type PaginatedChats = Paginated<UnipileChat>;
export type PaginatedMessages = Paginated<UnipileMessage>;
export type PaginatedConnections = Paginated<UnipileConnection>;
`);

write('src/lib/unipile.ts', `
import { UnipileAccount, UnipileChat, PaginatedChats, PaginatedMessages, UnipileMessage, AuthLinkParams, UnipileError as IUnipileError, UnipileProfile, PaginatedConnections } from '@/types/unipile';
export class UnipileError extends Error implements IUnipileError { status: number; code?: string; constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; } }
export class UnipileClient {
  constructor(private dsn: string, private token: string) { this.dsn = dsn.replace(/\\/$/, ''); }
  private async request<T>(method: string, path: string, body?: any, tryCount = 0): Promise<T> {
    const url = \`\${this.dsn}\${path.startsWith('/') ? path : '/' + path}\`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { method, headers: { 'X-API-KEY': this.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
      clearTimeout(id);
      if (response.status === 429 && tryCount === 0) {
        const retry = response.headers.get('Retry-After');
        await new Promise(r => setTimeout(r, retry ? parseInt(retry) * 1000 : 2000));
        return this.request<T>(method, path, body, 1);
      }
      if (!response.ok) {
        let err; try { err = await response.json(); } catch { err = { message: response.statusText }; }
        throw new UnipileError(err.message || 'API Error', response.status, err.code);
      }
      if (response.status === 204) return undefined as any;
      return await response.json();
    } catch (e: any) {
      clearTimeout(id);
      if (e instanceof UnipileError) throw e;
      throw new UnipileError(e.message || 'Request failed', 500);
    }
  }
  async listAccounts(): Promise<UnipileAccount[]> { return this.request('GET', '/api/v1/accounts'); }
  async getAccount(accountId: string): Promise<UnipileAccount> { return this.request('GET', \`/api/v1/accounts/\${accountId}\`); }
  async deleteAccount(accountId: string): Promise<void> { return this.request('DELETE', \`/api/v1/accounts/\${accountId}\`); }
  async generateAuthLink(params: AuthLinkParams): Promise<{ url: string }> { return this.request('POST', '/api/v1/hosted/accounts/link', params); }
  async listChats(accountId: string, cursor?: string): Promise<PaginatedChats> { const q = new URLSearchParams({ account_id: accountId }); if (cursor) q.append('cursor', cursor); return this.request('GET', \`/api/v1/chats?\${q}\`); }
  async getChat(chatId: string): Promise<UnipileChat> { return this.request('GET', \`/api/v1/chats/\${chatId}\`); }
  async getMessages(chatId: string, cursor?: string): Promise<PaginatedMessages> { const q = new URLSearchParams(); if (cursor) q.append('cursor', cursor); const qs = q.toString(); return this.request('GET', \`/api/v1/chats/\${chatId}/messages\${qs ? '?'+qs : ''}\`); }
  async markChatRead(chatId: string): Promise<void> { return this.request('POST', \`/api/v1/chats/\${chatId}/read\`); }
  async sendMessage(chatId: string, text: string): Promise<UnipileMessage> { return this.request('POST', \`/api/v1/chats/\${chatId}/messages\`, { text }); }
  async sendMessageToProfile(accountId: string, profileUrl: string, text: string): Promise<UnipileMessage> { return this.request('POST', \`/api/v1/messages\`, { account_id: accountId, attendees_ids: [profileUrl], text }); }
  async sendConnectionRequest(accountId: string, userId: string, note?: string): Promise<void> { return this.request('POST', \`/api/v1/users/invite\`, { account_id: accountId, provider_id: userId, message: note }); }
  async listConnections(accountId: string, cursor?: string): Promise<PaginatedConnections> { const q = new URLSearchParams({ account_id: accountId }); if (cursor) q.append('cursor', cursor); return this.request('GET', \`/api/v1/users/relations?\${q}\`); }
  async withdrawConnection(relationId: string): Promise<void> { return this.request('POST', \`/api/v1/users/relations/\${relationId}/withdraw\`); }
  async getProfile(userId: string): Promise<UnipileProfile> { return this.request('GET', \`/api/v1/users/\${userId}\`); }
  async searchPeople(accountId: string, query: string): Promise<UnipileProfile[]> { return this.request('GET', \`/api/v1/users/search?account_id=\${accountId}&query=\${encodeURIComponent(query)}\`); }
  async createPost(accountId: string, text: string): Promise<void> { return this.request('POST', \`/api/v1/posts\`, { account_id: accountId, text }); }
}
if (!process.env.UNIPILE_DSN || !process.env.UNIPILE_ACCESS_TOKEN) console.warn('Missing environment UNIPILE variables');
export const unipile = new UnipileClient(process.env.UNIPILE_DSN || '', process.env.UNIPILE_ACCESS_TOKEN || '');
`);

write('src/app/api/accounts/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { unipile } from '@/lib/unipile';
export async function GET(req: NextRequest) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { const accounts = await prisma.linkedInAccount.findMany({ where: { userId: session.user.id } }); return NextResponse.json(accounts); } catch (e: any) { return NextResponse.json({ error: e.message || 'Internal Error' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { name } = await req.json(); if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    const NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const authLink = await unipile.generateAuthLink({ providers: ['LINKEDIN'], name, success_redirect_url: \`\${NEXTAUTH_URL}/accounts?connected=1\`, failure_redirect_url: \`\${NEXTAUTH_URL}/accounts?error=1\` });
    return NextResponse.json({ authUrl: authLink.url });
  } catch (e: any) { return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 }); }
}
`);

write('src/app/api/accounts/[id]/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { unipile } from '@/lib/unipile';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const account = await prisma.linkedInAccount.findFirst({ where: { id: params.id, userId: session.user.id } });
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    return NextResponse.json(account);
  } catch (e: any) { return NextResponse.json({ error: e.message || 'Internal Error' }, { status: 500 }); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const account = await prisma.linkedInAccount.findFirst({ where: { id: params.id, userId: session.user.id } });
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    try { await unipile.deleteAccount(account.unipileAccountId); } catch (err) { console.warn(err); }
    await prisma.linkedInAccount.delete({ where: { id: params.id } });
    return new NextResponse(null, { status: 204 });
  } catch (e: any) { return NextResponse.json({ error: e.message || 'Internal Error' }, { status: 500 }); }
}
`);

write('src/app/api/conversations/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { unipile } from '@/lib/unipile';
export async function GET(req: NextRequest) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId'); const cursor = searchParams.get('cursor') || undefined; const search = searchParams.get('search') || undefined; const filter = searchParams.get('filter') || undefined;
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  try {
    const account = await prisma.linkedInAccount.findFirst({ where: { id: accountId, userId: session.user.id } });
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    const paginated = await unipile.listChats(account.unipileAccountId, cursor);
    for (const chat of paginated.items) {
      const participant = chat.participants.find(p => p.id !== account.unipileAccountId) || chat.participants[0];
      if (!participant) continue;
      const contact = await prisma.contact.upsert({
        where: { linkedinId_accountId: { linkedinId: participant.id, accountId: account.id } },
        update: { fullName: participant.name, headline: participant.headline, profileUrl: participant.profile_url, avatarUrl: participant.avatar_url },
        create: { linkedinId: participant.id, fullName: participant.name, headline: participant.headline, profileUrl: participant.profile_url, avatarUrl: participant.avatar_url, accountId: account.id }
      });
      await prisma.conversation.upsert({
        where: { unipileChatId: chat.id },
        update: { lastMessageAt: chat.last_message?.created_at ? new Date(chat.last_message.created_at) : null, unreadCount: chat.unread_count },
        create: { accountId: account.id, contactId: contact.id, unipileChatId: chat.id, lastMessageAt: chat.last_message?.created_at ? new Date(chat.last_message.created_at) : null, unreadCount: chat.unread_count }
      });
    }
    let conversations = paginated.items;
    if (search) { const lower = search.toLowerCase(); conversations = conversations.filter(c => c.participants.some(p => p.name?.toLowerCase().includes(lower)) || c.last_message?.text?.toLowerCase().includes(lower)); }
    if (filter === 'unread') conversations = conversations.filter(c => c.unread_count > 0);
    return NextResponse.json({ conversations, nextCursor: paginated.cursor, hasMore: paginated.has_more });
  } catch (e: any) { return NextResponse.json({ error: e.message || 'Internal Error' }, { status: 500 }); }
}
`);

write('src/app/api/conversations/[id]/messages/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { unipile } from '@/lib/unipile';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url); const cursor = searchParams.get('cursor') || undefined;
  try {
    const conversation = await prisma.conversation.findUnique({ where: { id: params.id }, include: { account: true } });
    if (!conversation || conversation.account.userId !== session.user.id) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    const paginated = await unipile.getMessages(conversation.unipileChatId, cursor);
    for (const msg of paginated.items) {
      const direction = msg.sender_id === conversation.account.unipileAccountId ? 'OUTBOUND' : 'INBOUND';
      await prisma.message.upsert({
        where: { id: msg.id },
        update: { body: msg.text, deliveryStatus: msg.is_read ? 'READ' : 'DELIVERED' },
        create: { id: msg.id, conversationId: conversation.id, direction, body: msg.text || '', sentAt: new Date(msg.created_at), deliveryStatus: msg.is_read ? 'READ' : (direction === 'OUTBOUND' ? 'SENT' : 'DELIVERED') }
      });
    }
    unipile.markChatRead(conversation.unipileChatId).catch(() => {});
    return NextResponse.json({ messages: paginated.items, nextCursor: paginated.cursor, hasMore: paginated.has_more });
  } catch (e: any) { return NextResponse.json({ error: e.message || 'Internal Error' }, { status: 500 }); }
}
`);

write('src/app/api/messages/send/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { unipile } from '@/lib/unipile';
import { z } from 'zod';
const SendSchema = z.union([z.object({ chatId: z.string(), text: z.string().min(1) }), z.object({ accountId: z.string(), profileUrl: z.string(), text: z.string().min(1) })]);
export async function POST(req: NextRequest) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json(); const parsed = SendSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', details: parsed.error.issues }, { status: 400 });
    const data = parsed.data; let upMessage, localId;
    if ('chatId' in data) {
      const conv = await prisma.conversation.findUnique({ where: { id: data.chatId }, include: { account: true } });
      if (!conv || conv.account.userId !== session.user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      upMessage = await unipile.sendMessage(conv.unipileChatId, data.text); localId = conv.id;
    } else {
      const acc = await prisma.linkedInAccount.findUnique({ where: { id: data.accountId } });
      if (!acc || acc.userId !== session.user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      upMessage = await unipile.sendMessageToProfile(acc.unipileAccountId, data.profileUrl, data.text);
      const conv = await prisma.conversation.findUnique({ where: { unipileChatId: upMessage.chat_id } }); if (conv) localId = conv.id;
    }
    if (localId) await prisma.message.create({ data: { id: upMessage.id, conversationId: localId, direction: 'OUTBOUND', body: upMessage.text || data.text, sentAt: new Date(upMessage.created_at || new Date()), deliveryStatus: 'SENT' } });
    return NextResponse.json(upMessage);
  } catch (e: any) { return NextResponse.json({ error: e.message || 'Error', code: e.code }, { status: 500 }); }
}
`);

write('src/app/api/connect/send/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { unipile } from '@/lib/unipile';
import { z } from 'zod';
const Schema = z.object({ accountId: z.string(), userId: z.string(), note: z.string().optional() });
export async function POST(req: NextRequest) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const p = Schema.safeParse(await req.json()); if (!p.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    const { accountId, userId, note } = p.data;
    const account = await prisma.linkedInAccount.findUnique({ where: { id: accountId } });
    if (!account || account.userId !== session.user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await unipile.sendConnectionRequest(account.unipileAccountId, userId, note);
    await prisma.activityLog.create({ data: { accountId: account.id, action: 'CONNECTION_SENT', metadata: { userId, note } } });
    return NextResponse.json({ success: true });
  } catch (e: any) { return NextResponse.json({ error: e.message || 'Error', code: e.code }, { status: 500 }); }
}
`);

write('src/app/api/webhooks/unipile/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text(); const sig = req.headers.get('X-Unipile-Signature'); const sec = process.env.UNIPILE_WEBHOOK_SECRET;
    if (!sec || !sig) return NextResponse.json({ error: 'No sig' }, { status: 401 });
    const digest = crypto.createHmac('sha256', sec).update(raw).digest('hex');
    try {
      const db = Buffer.from(digest), sb = Buffer.from(sig);
      if (db.length !== sb.length || !crypto.timingSafeEqual(db, sb)) return NextResponse.json({ error: 'Invalid sig' }, { status: 401 });
    } catch { return NextResponse.json({ error: 'Invalid sig match' }, { status: 401 }); }
    const p = JSON.parse(raw);
    (async () => {
      const { event, object } = p;
      if (event === 'new_message' && object) {
        const conv = await prisma.conversation.findUnique({ where: { unipileChatId: object.chat_id }, include: { account: true } });
        if (conv) {
          const dir = object.sender_id === conv.account.unipileAccountId ? 'OUTBOUND' : 'INBOUND';
          await prisma.message.upsert({
            where: { id: object.id }, update: { deliveryStatus: object.is_read ? 'READ' : 'DELIVERED' },
            create: { id: object.id, conversationId: conv.id, direction: dir, body: object.text || '', sentAt: new Date(object.created_at || new Date()), deliveryStatus: object.is_read ? 'READ' : (dir === 'OUTBOUND' ? 'SENT' : 'DELIVERED') }
          });
          if (dir === 'INBOUND') await prisma.conversation.update({ where: { id: conv.id }, data: { unreadCount: { increment: 1 }, lastMessageAt: new Date(object.created_at || new Date()) } });
        }
      } else if (event === 'connection_accepted' && object?.account_id) {
        const acc = await prisma.linkedInAccount.findUnique({ where: { unipileAccountId: object.account_id } });
        if (acc) await prisma.activityLog.create({ data: { accountId: acc.id, action: 'CONNECTION_ACCEPTED', metadata: { userId: object.provider_id || object.user_id } } });
      } else if (event === 'connection_requested' && object?.account_id) {
        const acc = await prisma.linkedInAccount.findUnique({ where: { unipileAccountId: object.account_id } });
        if (acc) await prisma.activityLog.create({ data: { accountId: acc.id, action: 'CONNECTION_RECEIVED', metadata: { userId: object.provider_id || object.user_id } } });
      }
    })().catch(console.error);
    return NextResponse.json({ received: true });
  } catch (e: any) { return NextResponse.json({ error: 'Internal Error' }, { status: 500 }); }
}
`);

write('src/lib/auth.ts', \`
export async function auth() {
  return { user: { id: 'test-user-id' } }; // mock auth session
}
\`);

write('src/lib/prisma.ts', \`
import { PrismaClient } from '@prisma/client'
const globalForPrisma = global as unknown as { prisma: PrismaClient }
export const prisma = globalForPrisma.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
export default prisma
\`);

console.log('Phase 2 files generated.');
