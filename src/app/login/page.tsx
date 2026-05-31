"use client";

import { useState } from "react";

/**
 * A minimal authentication screen that exercises the signup and login routes.
 * It is intentionally plain: the point of this starter is the systems
 * underneath, not a design system.
 */
export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
    const body =
      mode === "login"
        ? { email, password }
        : { email, password, organisationName };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      window.location.href = "/app/settings";
    } else {
      const data = (await res.json()) as { error?: string };
      setMessage(data.error ?? "request failed");
    }
  }

  return (
    <main>
      <h1>{mode === "login" ? "Sign in" : "Create your organisation"}</h1>
      <form className="panel" onSubmit={submit}>
        {mode === "signup" && (
          <p>
            <label>
              Organisation name
              <br />
              <input
                value={organisationName}
                onChange={(e) => setOrganisationName(e.target.value)}
                required
              />
            </label>
          </p>
        )}
        <p>
          <label>
            Email
            <br />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
        </p>
        <p>
          <label>
            Password
            <br />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
        </p>
        <button type="submit">
          {mode === "login" ? "Sign in" : "Create"}
        </button>
        {message && <p className="muted">{message}</p>}
      </form>
      <p className="muted">
        {mode === "login" ? "Need an organisation? " : "Already have one? "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setMode(mode === "login" ? "signup" : "login");
          }}
        >
          {mode === "login" ? "Sign up" : "Sign in"}
        </a>
      </p>
    </main>
  );
}
