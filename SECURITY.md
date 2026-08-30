# Security baseline

Before production:

- Replace development OTP with an approved SMS/verification provider.
- Add customer PIN and device-bound biometric unlock for local convenience; keep server authorization authoritative.
- Use a managed secrets store, never source control.
- Restrict provider API egress and rotate credentials.
- Add request correlation IDs, structured audit logs, alerts, and anomaly detection.
- Use real provider webhook signature rules and replay protection.
- Add transfer velocity limits per user, device, recipient, and funding source.
- Add KYC tiering, sanctions/PEP checks where legally required, suspicious activity workflows, and manual review.
- Encrypt sensitive data in transit and at rest.
- Perform SAST, dependency scanning, penetration testing and incident-response exercises.
- Separate production, staging and development accounts/databases.
