export default function Home() {
  return (
    <main>
      <span className="badge">multi-tenant SaaS starter</span>
      <h1>shipyard</h1>
      <p className="muted">
        Organisations, RBAC, billing, audit log and rate limiting done properly,
        on Next.js 16 and TypeScript.
      </p>

      <div className="panel">
        <h2>What is wired up</h2>
        <ul>
          <li>
            Strict row-level multi-tenancy through a single scoped repository.
          </li>
          <li>Session-based authentication with scrypt password hashing.</li>
          <li>
            Permission-based RBAC enforced on every protected route via a guard.
          </li>
          <li>An append-only audit log for every privileged action.</li>
          <li>A token-bucket rate limiter on the API surface.</li>
          <li>
            A billing scaffold with usage budgets behind a provider interface.
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2>Get going</h2>
        <p>
          Open the <a href="/app/settings">settings dashboard</a> to see members,
          billing and the audit log wired together, or read the{" "}
          <a href="https://github.com/sarmakska/shipyard/wiki">
            documentation
          </a>
          .
        </p>
      </div>
    </main>
  );
}
