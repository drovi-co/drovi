import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { Resend } from "resend";

// Initialize Resend client (optional - emails won't send without API key)
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  template: ReactElement;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  tags?: { name: string; value: string }[];
}

export async function sendEmail({
  to,
  subject,
  template,
  from = process.env.EMAIL_FROM ?? "noreply@memorystack.app",
  replyTo,
  cc,
  bcc,
  tags,
}: SendEmailOptions) {
  if (!resend) {
    console.warn("Email not sent - RESEND_API_KEY not configured:", {
      to,
      subject,
    });
    return { id: "mock-email-id" };
  }

  const html = await render(template);

  const result = await resend.emails.send({
    from,
    to,
    subject,
    html,
    replyTo,
    cc,
    bcc,
    tags,
  });

  if (result.error) {
    console.error("Failed to send email:", result.error);
    throw new Error(result.error.message);
  }

  return result.data;
}

export async function sendBatchEmails(
  emails: Array<{
    to: string | string[];
    subject: string;
    template: ReactElement;
    from?: string;
  }>
) {
  if (!resend) {
    console.warn("Batch emails not sent - RESEND_API_KEY not configured:", {
      count: emails.length,
    });
    return { data: emails.map(() => ({ id: "mock-email-id" })) };
  }

  const emailPromises = emails.map(async (email) => ({
    from: email.from ?? process.env.EMAIL_FROM ?? "noreply@memorystack.app",
    to: email.to,
    subject: email.subject,
    html: await render(email.template),
  }));

  const preparedEmails = await Promise.all(emailPromises);

  const result = await resend.batch.send(preparedEmails);

  if (result.error) {
    console.error("Failed to send batch emails:", result.error);
    throw new Error(result.error.message);
  }

  return result.data;
}

export { resend };

// Re-export templates
export * from "./templates/index.js";
