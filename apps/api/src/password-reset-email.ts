import { z } from 'zod';

const passwordResetEmailProviderSchema = z.enum(['', 'resend']);

export interface PasswordResetEmailService {
  readonly configured: boolean;
  sendPasswordReset(input: {
    to: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}

export class PasswordResetEmailDeliveryError extends Error {
  constructor(message = 'Password reset email delivery failed') {
    super(message);
  }
}

class DisabledPasswordResetEmailService implements PasswordResetEmailService {
  readonly configured = false;

  async sendPasswordReset(): Promise<void> {
    throw new PasswordResetEmailDeliveryError('Password reset email delivery is not configured');
  }
}

class ResendPasswordResetEmailService implements PasswordResetEmailService {
  readonly configured = true;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendPasswordReset(input: {
    to: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    const escapedResetUrl = input.resetUrl
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: input.to,
        subject: 'Reset your TiCash password',
        text: [
          'We received a request to reset your TiCash password.',
          `Use this link within 30 minutes: ${input.resetUrl}`,
          `This link expires at ${input.expiresAt.toISOString()}.`,
          'If you did not request this change, you can ignore this email.',
        ].join('\n\n'),
        html: [
          '<p>We received a request to reset your TiCash password.</p>',
          `<p><a href="${escapedResetUrl}">Reset your password</a></p>`,
          `<p>This link expires at ${input.expiresAt.toISOString()}.</p>`,
          '<p>If you did not request this change, you can ignore this email.</p>',
        ].join(''),
      }),
    });

    if (!response.ok) throw new PasswordResetEmailDeliveryError();
  }
}

export function passwordResetUrl(token: string, environment: NodeJS.ProcessEnv = process.env): string {
  const baseUrl = environment.PASSWORD_RESET_URL_BASE?.trim();
  if (!baseUrl) throw new PasswordResetEmailDeliveryError('Password reset email delivery is not configured');
  const url = new URL(baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

export function loadPasswordResetEmailService(
  environment: NodeJS.ProcessEnv = process.env,
): PasswordResetEmailService {
  const provider = passwordResetEmailProviderSchema.parse(
    (environment.PASSWORD_RESET_EMAIL_PROVIDER ?? '').trim().toLowerCase(),
  );

  if (!provider) return new DisabledPasswordResetEmailService();
  if (provider !== 'resend') throw new Error('Unsupported PASSWORD_RESET_EMAIL_PROVIDER');

  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = environment.PASSWORD_RESET_EMAIL_FROM?.trim();
  const resetUrlBase = environment.PASSWORD_RESET_URL_BASE?.trim();
  if (!apiKey || !from || !resetUrlBase) return new DisabledPasswordResetEmailService();

  return new ResendPasswordResetEmailService(apiKey, from);
}
