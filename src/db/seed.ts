import { Database } from "@/db/client";
import { Repository } from "@/db/repository";
import { AuthService } from "@/lib/auth";
import { MembersService } from "@/lib/members";
import { resolveContext } from "@/lib/context";
import { BillingService } from "@/lib/billing/service";
import { FakeBillingProvider } from "@/lib/billing/provider-fake";

/**
 * Seed a database with two organisations so the dashboard has something to
 * show. Run with `pnpm seed`. Set SHIPYARD_DB_PATH to persist to a file.
 */
async function seed() {
  const location = process.env.SHIPYARD_DB_PATH ?? "shipyard.db";
  const db = new Database(location);
  db.migrate();
  const repo = new Repository(db);
  const auth = new AuthService(repo);

  const acme = auth.signup({
    email: "owner@acme.test",
    password: "password-acme-123",
    organisationName: "Acme",
  });
  const acmeCtx = resolveContext(repo, acme.token);
  const members = new MembersService(repo);
  members.invite(acmeCtx, "admin@acme.test", "admin");
  members.invite(acmeCtx, "viewer@acme.test", "viewer");

  const billing = new BillingService(repo, new FakeBillingProvider());
  await billing.subscribe(
    acme.organisationId,
    acme.user.email,
    "pro",
    acme.user.id,
  );
  billing.incrementUsage(acme.organisationId, "api_calls", 1234);

  auth.signup({
    email: "owner@globex.test",
    password: "password-globex-123",
    organisationName: "Globex",
  });

  console.log(`Seeded ${location}: Acme (owner@acme.test) and Globex.`);
  db.close();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
