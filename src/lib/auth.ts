import { createHash } from "node:crypto";
import type { Repository } from "@/db";
import type { Membership, Role, Session, User } from "@/db/schema";
import {
  generateSessionToken,
  hashPassword,
  newId,
  verifyPassword,
} from "./crypto";
import { recordAudit } from "./audit";

/**
 * Session-based authentication.
 *
 * Sessions are opaque random tokens. Only a SHA-256 hash of the token is stored
 * in the database, so a database leak does not hand an attacker live sessions.
 * The plaintext token is what goes into the cookie. This is the standard
 * approach for self-managed sessions and leaves a clean seam for OAuth: an
 * OAuth callback simply resolves to a User and calls createSession.
 */

export const SESSION_COOKIE = "shipyard_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export class AuthError extends Error {
  readonly status = 401;
  constructor(message = "unauthenticated") {
    super(message);
    this.name = "AuthError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SignupInput {
  email: string;
  password: string;
  organisationName: string;
}

export interface AuthResult {
  user: User;
  organisationId: string;
  token: string;
}

export class AuthService {
  constructor(private readonly repo: Repository) {}

  /** Register a user and create their first organisation, owned by them. */
  signup(input: SignupInput, now = Date.now()): AuthResult {
    const email = input.email.trim().toLowerCase();
    const existing = this.repo.selectOneGlobal<User>("users", { email });
    if (existing) throw new AuthError("email already registered");

    const user: User = {
      id: newId(),
      email,
      passwordHash: hashPassword(input.password),
      createdAt: now,
    };
    this.repo.insertGlobal("users", user);

    const orgId = newId();
    const slug =
      input.organisationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") +
      "-" +
      orgId.slice(0, 8);
    this.repo.insertGlobal("organisations", {
      id: orgId,
      name: input.organisationName,
      slug,
      createdAt: now,
    });

    const membership: Membership = {
      id: newId(),
      organisationId: orgId,
      userId: user.id,
      role: "owner",
      createdAt: now,
    };
    this.repo.insertScoped(orgId, "memberships", {
      id: membership.id,
      userId: membership.userId,
      role: membership.role,
      createdAt: membership.createdAt,
    });

    recordAudit(this.repo, {
      organisationId: orgId,
      actorUserId: user.id,
      action: "auth.signup",
      metadata: { email },
    });

    const token = this.createSession(user.id, orgId, now);
    return { user, organisationId: orgId, token };
  }

  /** Verify credentials and open a session on the user's first organisation. */
  login(email: string, password: string, now = Date.now()): AuthResult {
    const normalised = email.trim().toLowerCase();
    const user = this.repo.selectOneGlobal<User>("users", {
      email: normalised,
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new AuthError("invalid credentials");
    }
    const membership = this.repo.selectOneGlobal<Membership>("memberships", {
      userId: user.id,
    });
    const orgId = membership?.organisationId ?? null;
    const token = this.createSession(user.id, orgId, now);
    return { user, organisationId: orgId ?? "", token };
  }

  /** Issue a session and return the plaintext token for the cookie. */
  createSession(
    userId: string,
    organisationId: string | null,
    now = Date.now(),
  ): string {
    const token = generateSessionToken();
    const session: Session = {
      id: hashToken(token),
      userId,
      organisationId,
      expiresAt: now + SESSION_TTL_MS,
      createdAt: now,
    };
    this.repo.insertGlobal("sessions", session);
    return token;
  }

  /** Resolve a session token to its session row, or null if absent/expired. */
  resolveSession(token: string, now = Date.now()): Session | null {
    const session = this.repo.selectOneGlobal<Session>("sessions", {
      id: hashToken(token),
    });
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.repo.deleteGlobal("sessions", { id: session.id });
      return null;
    }
    return session;
  }

  logout(token: string): void {
    this.repo.deleteGlobal("sessions", { id: hashToken(token) });
  }

  /** The membership (and therefore role) of a user within an organisation. */
  membership(userId: string, organisationId: string): Membership | null {
    const rows = this.repo.selectScoped<Membership>(
      organisationId,
      "memberships",
      { userId },
    );
    return rows[0] ?? null;
  }

  roleOf(userId: string, organisationId: string): Role | null {
    return this.membership(userId, organisationId)?.role ?? null;
  }
}
