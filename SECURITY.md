# Security policy

I take the security of shipyard seriously, because the whole point of the
project is to get multi-tenant isolation and access control right.

## Reporting a vulnerability

Please report security issues privately to security@sarmalinux.com. Do not open a
public issue for a vulnerability.

Include as much as you can: the affected version or commit, a description of the
issue, and a proof of concept or reproduction steps if you have one. If you have
found a way to read or write across tenants, bypass an RBAC check, or forge a
session, that is exactly what I want to hear about.

## My commitment

I will acknowledge your report within 7 days. After that I will keep you updated
on my assessment and the fix timeline, and I will credit you in the release
notes once a fix ships, unless you prefer to remain anonymous.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| < 0.1 | No |

## Scope notes

The SQLite data layer is intended for local development and tests, not for
production. The Stripe adapter ships real webhook signature verification but
requires the Stripe SDK for live API calls. Findings in these areas are still
welcome, but please mention which path you are exercising.
