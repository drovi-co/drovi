import { task } from "@trigger.dev/sdk";

// Email sending task - wraps Resend to handle retries and failures
export const sendEmailTask = task({
  id: "send-email",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (payload: {
    to: string | string[];
    subject: string;
    html: string;
    from?: string;
    replyTo?: string;
    tags?: { name: string; value: string }[];
  }) => {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({
      from: payload.from ?? process.env.EMAIL_FROM ?? "noreply@drovi.io",
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      replyTo: payload.replyTo,
      tags: payload.tags,
    });

    if (result.error) {
      throw new Error(`Failed to send email: ${result.error.message}`);
    }

    return {
      emailId: result.data?.id,
      to: payload.to,
      subject: payload.subject,
    };
  },
});

// Welcome email task
export const sendWelcomeEmailTask = task({
  id: "send-welcome-email",
  run: async (payload: { userId: string; userName: string; email: string }) => {
    const { render } = await import("@react-email/render");
    const { WelcomeEmail } = await import("@memorystack/email/templates");

    const html = await render(
      WelcomeEmail({
        userName: payload.userName,
        appUrl: process.env.APP_URL ?? "https://app.drovi.io",
      })
    );

    await sendEmailTask.triggerAndWait({
      to: payload.email,
      subject: "Welcome to Drovi!",
      html,
      tags: [
        { name: "type", value: "welcome" },
        { name: "userId", value: payload.userId },
      ],
    });

    return { success: true, userId: payload.userId };
  },
});

// Invitation email task
export const sendInvitationEmailTask = task({
  id: "send-invitation-email",
  run: async (payload: {
    invitationId: string;
    email: string;
    inviterName: string;
    organizationName: string;
    role: string;
    inviteLink: string;
  }) => {
    const { render } = await import("@react-email/render");
    const { InvitationEmail } = await import("@memorystack/email/templates");

    const html = await render(
      InvitationEmail({
        inviterName: payload.inviterName,
        organizationName: payload.organizationName,
        role: payload.role,
        inviteLink: payload.inviteLink,
      })
    );

    await sendEmailTask.triggerAndWait({
      to: payload.email,
      subject: `You've been invited to join ${payload.organizationName}`,
      html,
      tags: [
        { name: "type", value: "invitation" },
        { name: "invitationId", value: payload.invitationId },
      ],
    });

    return { success: true, invitationId: payload.invitationId };
  },
});

// Waitlist confirmation email task
export const sendWaitlistConfirmationEmailTask = task({
  id: "send-waitlist-confirmation-email",
  run: async (payload: {
    applicationId: string;
    email: string;
    userName: string;
  }) => {
    const { render } = await import("@react-email/render");
    const { WaitlistConfirmationEmail } = await import(
      "@memorystack/email/templates"
    );

    const html = await render(
      WaitlistConfirmationEmail({
        userName: payload.userName,
        appUrl: process.env.APP_URL ?? "https://drovi.io",
      })
    );

    await sendEmailTask.triggerAndWait({
      to: payload.email,
      subject: "You're on the Drovi waitlist!",
      html,
      tags: [
        { name: "type", value: "waitlist-confirmation" },
        { name: "applicationId", value: payload.applicationId },
      ],
    });

    return { success: true, applicationId: payload.applicationId };
  },
});

// Waitlist approval email task
export const sendWaitlistApprovalEmailTask = task({
  id: "send-waitlist-approval-email",
  run: async (payload: {
    applicationId: string;
    email: string;
    userName: string;
    inviteCode: string;
  }) => {
    const { render } = await import("@react-email/render");
    const { WaitlistApprovalEmail } = await import(
      "@memorystack/email/templates"
    );

    const html = await render(
      WaitlistApprovalEmail({
        userName: payload.userName,
        inviteCode: payload.inviteCode,
        appUrl: process.env.APP_URL ?? "https://drovi.io",
      })
    );

    await sendEmailTask.triggerAndWait({
      to: payload.email,
      subject: "Your Drovi invite is ready!",
      html,
      tags: [
        { name: "type", value: "waitlist-approval" },
        { name: "applicationId", value: payload.applicationId },
        { name: "inviteCode", value: payload.inviteCode },
      ],
    });

    return { success: true, applicationId: payload.applicationId };
  },
});
