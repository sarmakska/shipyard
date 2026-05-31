import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { resolveContext } from "@/lib/context";
import { MembersService } from "@/lib/members";
import { listAudit } from "@/lib/audit";
import { BillingService } from "@/lib/billing/service";
import { FakeBillingProvider } from "@/lib/billing/provider-fake";
import { permissionsForRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * The admin/settings dashboard. A server component that resolves the request
 * context once, then renders the tenant's members, subscription, usage and
 * audit trail. Everything shown is scoped to ctx.organisationId, so this page
 * can never leak another tenant's data.
 */
export default async function SettingsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  let ctx;
  try {
    ctx = resolveContext(db(), token);
  } catch {
    redirect("/login?next=/app/settings");
  }

  const repo = db();
  const members = new MembersService(repo).list(ctx);
  const audit = listAudit(repo, ctx.organisationId).slice(0, 20);
  const billing = new BillingService(repo, new FakeBillingProvider());
  const subscription = billing.getSubscription(ctx.organisationId);
  const permissions = [...permissionsForRole(ctx.role)];

  return (
    <main>
      <span className="badge">{ctx.role}</span>
      <h1>Settings</h1>
      <p className="muted">
        Signed in as {ctx.user.email}. Organisation {ctx.organisationId}.
      </p>

      <div className="panel">
        <h2>Members</h2>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.userId}</td>
                <td>{m.role}</td>
                <td>{new Date(m.createdAt).toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Billing</h2>
        <p>
          Plan: <code>{subscription?.plan ?? "free"}</code> Status:{" "}
          <code>{subscription?.status ?? "none"}</code>
        </p>
      </div>

      <div className="panel">
        <h2>Your permissions</h2>
        <p className="muted">{permissions.join(", ")}</p>
      </div>

      <div className="panel">
        <h2>Audit log</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toISOString()}</td>
                <td>{e.action}</td>
                <td>{e.actorUserId ?? "system"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
