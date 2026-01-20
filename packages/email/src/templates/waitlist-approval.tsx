import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface WaitlistApprovalEmailProps {
  userName: string;
  inviteCode: string;
  appUrl?: string;
}

export function WaitlistApprovalEmail({
  userName,
  inviteCode,
  appUrl = "https://drovi.io",
}: WaitlistApprovalEmailProps) {
  const signupUrl = `${appUrl}/login?code=${inviteCode}`;

  return (
    <Html>
      <Head />
      <Preview>Your Drovi invite is ready - {inviteCode}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>You're in!</Heading>
          <Text style={text}>Hi {userName},</Text>
          <Text style={text}>
            Great news! Your Drovi application has been approved. We're excited
            to welcome you to our community of users who are transforming how
            they work with their communications.
          </Text>

          {/* Invite Code Box */}
          <Section style={codeBox}>
            <Text style={codeLabel}>Your exclusive invite code</Text>
            <Text style={codeText}>{inviteCode}</Text>
          </Section>

          <Section style={buttonContainer}>
            <Button href={signupUrl} style={button}>
              Create Your Account
            </Button>
          </Section>

          <Text style={smallText}>
            Or copy this link:{" "}
            <Link href={signupUrl} style={link}>
              {signupUrl}
            </Link>
          </Text>

          <Hr style={hr} />

          <Text style={highlight}>What you'll get access to:</Text>
          <ul style={list}>
            <li style={listItem}>
              <strong>Unified Smart Inbox</strong> - All your communications in
              one place with AI-powered briefs
            </li>
            <li style={listItem}>
              <strong>Commitment Tracking</strong> - Never lose track of
              promises, requests, and follow-ups
            </li>
            <li style={listItem}>
              <strong>Decision Memory</strong> - Capture decisions with context
              and never re-litigate
            </li>
            <li style={listItem}>
              <strong>Ask Drovi</strong> - Get answers grounded in your
              communications
            </li>
          </ul>

          <Hr style={hr} />

          <Text style={footer}>
            Questions? We're here to help. Just reply to this email or reach out
            at{" "}
            <Link href="mailto:hello@drovi.io" style={link}>
              hello@drovi.io
            </Link>
            .
          </Text>
          <Text style={footer}>
            See you inside!
            <br />
            The Drovi Team
          </Text>

          <Text style={disclaimer}>
            This invite code is unique to you. Please don't share it with
            others.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "40px 20px",
  maxWidth: "560px",
};

const h1 = {
  color: "#1a1a1a",
  fontSize: "28px",
  fontWeight: "600",
  lineHeight: "1.25",
  marginBottom: "24px",
};

const text = {
  color: "#374151",
  fontSize: "16px",
  lineHeight: "1.5",
  marginBottom: "16px",
};

const smallText = {
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "1.5",
  marginTop: "16px",
  textAlign: "center" as const,
};

const codeBox = {
  backgroundColor: "#f3f0ff",
  borderRadius: "8px",
  padding: "24px",
  marginTop: "24px",
  marginBottom: "8px",
  textAlign: "center" as const,
  border: "1px solid #c4b5fd",
};

const codeLabel = {
  color: "#6b7280",
  fontSize: "12px",
  fontWeight: "500",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  marginBottom: "8px",
};

const codeText = {
  color: "#7c3aed",
  fontSize: "32px",
  fontWeight: "700",
  fontFamily: "monospace",
  letterSpacing: "0.1em",
  margin: "0",
};

const buttonContainer = {
  marginTop: "24px",
  marginBottom: "8px",
  textAlign: "center" as const,
};

const button = {
  backgroundColor: "#7c3aed",
  borderRadius: "6px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 32px",
};

const highlight = {
  color: "#1a1a1a",
  fontSize: "16px",
  fontWeight: "600",
  lineHeight: "1.5",
  marginTop: "24px",
  marginBottom: "8px",
};

const list = {
  marginTop: "8px",
  marginBottom: "16px",
  paddingLeft: "24px",
};

const listItem = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "1.6",
  marginBottom: "12px",
};

const hr = {
  borderColor: "#e6ebf1",
  margin: "32px 0",
};

const footer = {
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "1.5",
};

const link = {
  color: "#7c3aed",
  textDecoration: "underline",
};

const disclaimer = {
  color: "#9ca3af",
  fontSize: "12px",
  lineHeight: "1.5",
  marginTop: "24px",
  textAlign: "center" as const,
};

export default WaitlistApprovalEmail;
