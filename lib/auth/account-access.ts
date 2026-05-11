import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserById, type User } from '@/lib/models/user';
import {
  getAuthenticatedActor,
  type AuthenticatedActor,
} from '@/lib/server/backend-api';

const ACCOUNT_ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;
const CONVERSATION_ID_RE = /^[a-zA-Z0-9._:-]{1,256}$/;

type AccessOptions = {
  allowApiSecret?: boolean;
};

type HydratedActor = {
  actor: AuthenticatedActor;
  user: Pick<User, 'id' | 'email' | 'name' | 'role'> | null;
  allowedAccountIds: Set<string>;
};

function noStoreHeaders() {
  return {
    'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
    Pragma: 'no-cache',
    Vary: 'Cookie, Authorization, Origin',
  };
}

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders() });
}

function normalizePrincipalKey(value: string) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAccountId(value: string) {
  return String(value || '').trim();
}

function parseConfiguredAccountAccess(): Map<string, Set<string>> {
  const raw = process.env.USER_ACCOUNT_ACCESS ?? process.env.ACCOUNT_ACCESS_MAP ?? '';
  if (!raw.trim()) return new Map();

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mapping = new Map<string, Set<string>>();

    for (const [principal, allowedAccounts] of Object.entries(parsed || {})) {
      const normalizedPrincipal = normalizePrincipalKey(principal);
      if (!normalizedPrincipal) continue;

      const values = Array.isArray(allowedAccounts)
        ? allowedAccounts
        : typeof allowedAccounts === 'string'
          ? allowedAccounts.split(',')
          : [];

      const allowedSet = new Set(
        values
          .map((value) => normalizeAccountId(String(value || '')))
          .filter((value) => ACCOUNT_ID_RE.test(value))
      );

      if (allowedSet.size > 0) {
        mapping.set(normalizedPrincipal, allowedSet);
      }
    }

    return mapping;
  } catch {
    return new Map();
  }
}

function getAllowedAccountIdsForUser(user: Pick<User, 'id' | 'email' | 'role'> | null): Set<string> {
  if (!user || user.role === 'admin') return new Set();

  const configured = parseConfiguredAccountAccess();
  const accountIds = new Set<string>();

  const principalKeys = [user.id, user.email]
    .map((value) => normalizePrincipalKey(String(value || '')))
    .filter(Boolean);

  for (const key of principalKeys) {
    const mappedAccounts = configured.get(key);
    if (!mappedAccounts) continue;
    for (const accountId of mappedAccounts) {
      accountIds.add(accountId);
    }
  }

  return accountIds;
}

async function hydrateActor(req: NextRequest, options: AccessOptions = {}): Promise<{ data?: HydratedActor; response?: NextResponse }> {
  const { actor, response } = await getAuthenticatedActor(req, options);
  if (response || !actor) {
    return { response: response ?? jsonError(401, 'Unauthorized') };
  }

  if (actor.kind !== 'user-session') {
    return {
      data: {
        actor,
        user: null,
        allowedAccountIds: new Set(),
      },
    };
  }

  if (!actor.userId) {
    return { response: jsonError(401, 'Unauthorized') };
  }

  const dbUser = await getUserById(actor.userId);
  if (!dbUser) {
    return { response: jsonError(401, 'Unauthorized') };
  }

  const hydratedUser = {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role,
  };

  return {
    data: {
      actor: {
        ...actor,
        role: hydratedUser.role,
        email: hydratedUser.email,
        name: hydratedUser.name,
      },
      user: hydratedUser,
      allowedAccountIds: getAllowedAccountIdsForUser(hydratedUser),
    },
  };
}

export async function authorizeAccountAccess(
  req: NextRequest,
  accountId: string,
  options: AccessOptions = {}
): Promise<{ actor?: AuthenticatedActor; allowedAccountIds?: Set<string>; accountId?: string; response?: NextResponse }> {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!ACCOUNT_ID_RE.test(normalizedAccountId)) {
    return { response: jsonError(400, 'Invalid accountId') };
  }

  const hydrated = await hydrateActor(req, options);
  if (hydrated.response || !hydrated.data) {
    return { response: hydrated.response ?? jsonError(401, 'Unauthorized') };
  }

  if (hydrated.data.actor.role === 'admin' || hydrated.data.actor.kind !== 'user-session') {
    return {
      actor: hydrated.data.actor,
      allowedAccountIds: hydrated.data.allowedAccountIds,
      accountId: normalizedAccountId,
    };
  }

  if (!hydrated.data.allowedAccountIds.has(normalizedAccountId)) {
    return { response: jsonError(403, 'Forbidden: account access denied') };
  }

  return {
    actor: hydrated.data.actor,
    allowedAccountIds: hydrated.data.allowedAccountIds,
    accountId: normalizedAccountId,
  };
}

export async function authorizeCollectionAccess(
  req: NextRequest,
  options: AccessOptions = {}
): Promise<{ actor?: AuthenticatedActor; allowedAccountIds?: Set<string>; response?: NextResponse }> {
  const hydrated = await hydrateActor(req, options);
  if (hydrated.response || !hydrated.data) {
    return { response: hydrated.response ?? jsonError(401, 'Unauthorized') };
  }

  if (hydrated.data.actor.role === 'admin' || hydrated.data.actor.kind !== 'user-session') {
    return {
      actor: hydrated.data.actor,
      allowedAccountIds: hydrated.data.allowedAccountIds,
    };
  }

  if (hydrated.data.allowedAccountIds.size === 0) {
    return { response: jsonError(403, 'Forbidden: no assigned account access') };
  }

  return {
    actor: hydrated.data.actor,
    allowedAccountIds: hydrated.data.allowedAccountIds,
  };
}

export async function authorizeConversationAccess(
  req: NextRequest,
  conversationId: string,
  options: AccessOptions = {}
): Promise<{ actor?: AuthenticatedActor; allowedAccountIds?: Set<string>; accountId?: string; conversationId?: string; response?: NextResponse }> {
  const normalizedConversationId = String(conversationId || '').trim();
  if (!CONVERSATION_ID_RE.test(normalizedConversationId)) {
    return { response: jsonError(400, 'Invalid conversationId') };
  }

  const hydrated = await hydrateActor(req, options);
  if (hydrated.response || !hydrated.data) {
    return { response: hydrated.response ?? jsonError(401, 'Unauthorized') };
  }

  const conversationResult = await query(
    'SELECT id, "accountId" FROM conversations WHERE id = $1 LIMIT 1',
    [normalizedConversationId]
  );
  const conversation = conversationResult.rows[0] as { id: string; accountId: string } | undefined;
  if (!conversation?.accountId) {
    return { response: jsonError(400, 'Unknown conversationId') };
  }

  if (hydrated.data.actor.role === 'admin' || hydrated.data.actor.kind !== 'user-session') {
    return {
      actor: hydrated.data.actor,
      allowedAccountIds: hydrated.data.allowedAccountIds,
      accountId: String(conversation.accountId),
      conversationId: normalizedConversationId,
    };
  }

  if (!hydrated.data.allowedAccountIds.has(String(conversation.accountId))) {
    return { response: jsonError(403, 'Forbidden: account access denied') };
  }

  return {
    actor: hydrated.data.actor,
    allowedAccountIds: hydrated.data.allowedAccountIds,
    accountId: String(conversation.accountId),
    conversationId: normalizedConversationId,
  };
}

export function filterAccountScopedPayload<T extends { accountId?: string }>(
  items: T[],
  allowedAccountIds: Set<string>
): T[] {
  return items.filter((item) => allowedAccountIds.has(String(item?.accountId || '')));
}
