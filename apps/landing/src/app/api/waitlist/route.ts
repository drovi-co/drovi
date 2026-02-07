export const runtime = "edge";

type WaitlistPayload = {
  email: string;
  name: string;
  company?: string;
  role?: string;
  useCase?: string;
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  let payload: WaitlistPayload;
  try {
    payload = (await request.json()) as WaitlistPayload;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const email = (payload.email || "").trim();
  const name = (payload.name || "").trim();

  if (!email || !isValidEmail(email)) {
    return Response.json({ ok: false, error: "Invalid email" }, { status: 400 });
  }
  if (!name || name.length < 2) {
    return Response.json({ ok: false, error: "Invalid name" }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const to = process.env.WAITLIST_NOTIFY_TO || "support@drovi.co";
    const from = process.env.WAITLIST_NOTIFY_FROM || "Drovi <onboarding@resend.dev>";

    const lines = [
      `email: ${email}`,
      `name: ${name}`,
      payload.company ? `company: ${payload.company}` : null,
      payload.role ? `role: ${payload.role}` : null,
      payload.useCase ? `useCase: ${payload.useCase}` : null,
      "",
      `userAgent: ${request.headers.get("user-agent") || ""}`,
      `ip: ${request.headers.get("cf-connecting-ip") || ""}`,
    ].filter(Boolean);

    const subject = `Drovi waitlist: ${email}`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: lines.join("\n"),
      }),
    });

    if (!resendResponse.ok) {
      return Response.json(
        { ok: false, error: "Failed to submit. Try again later." },
        { status: 500 }
      );
    }
  }

  // If Resend is not configured, we still return OK so the UI works in dev.
  return Response.json({ ok: true });
}

