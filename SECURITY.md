# Security Policy

## Supported versions

Only the latest version on the `main` branch is supported. Fixes are not backported.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub instead:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, steps to reproduce, and the impact you expect.

I aim to acknowledge reports within 7 days and will keep you updated until the issue is resolved. With your permission, I'm happy to credit you in the fix.

## Scope

Outdoor Console is a static, client-side page with no backend, accounts, or stored secrets. Relevant reports include:

- Cross-site scripting (XSS) or HTML injection via user input or API responses
- Unsafe handling of data stored in `localStorage`
- Risks from third-party scripts or styles the page loads

Out of scope: vulnerabilities in the third-party services themselves (Open-Meteo, Zippopotam.us, jsDelivr, Google Fonts, or the external map sites). Please report those to the respective provider.
