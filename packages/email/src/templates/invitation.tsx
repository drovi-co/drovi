import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface InvitationEmailProps {
  inviterName: string;
  organizationName: string;
  role: string;
  inviteLink: string;
  expiresIn?: string;
}

export function InvitationEmail({
  inviterName,
  organizationName,
  role,
  inviteLink,
  expiresIn = "7 days",
}: InvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {inviterName} invited you to join {organizationName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>You've been invited!</Heading>
          <Text style={text}>
            <strong>{inviterName}</strong> has invited you to join{" "}
            <strong>{organizationName}</strong> on Drovi as a{" "}
            <strong>{role}</strong>.
          </Text>
          <Section style={buttonContainer}>
            <Button href={inviteLink} style={button}>
              Accept Invitation
            </Button>
          </Section>
          <Text style={text}>
            This invitation will expire in {expiresIn}. If you don't want to
            join, you can safely ignore this email.
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            If the button doesn't work, copy and paste this link into your
            browser:
          </Text>
          <Text style={linkText}>{inviteLink}</Text>
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
  fontSize: "24px",
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

const buttonContainer = {
  marginTop: "24px",
  marginBottom: "24px",
};

const button = {
  backgroundColor: "#000000",
  borderRadius: "6px",
  color: "#fff",
  fontSize: "14px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "12px 24px",
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

const linkText = {
  color: "#6b7280",
  fontSize: "12px",
  lineHeight: "1.5",
  wordBreak: "break-all" as const,
};

export default InvitationEmail;
