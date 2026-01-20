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

interface InvitationAcceptedEmailProps {
  memberName: string;
  memberEmail: string;
  organizationName: string;
  dashboardUrl?: string;
}

export function InvitationAcceptedEmail({
  memberName,
  memberEmail,
  organizationName,
  dashboardUrl = "https://app.drovi.io/dashboard/team/members",
}: InvitationAcceptedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {memberName} joined {organizationName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>New Team Member!</Heading>
          <Text style={text}>
            Great news! <strong>{memberName}</strong> ({memberEmail}) has
            accepted your invitation and joined{" "}
            <strong>{organizationName}</strong>.
          </Text>
          <Section style={buttonContainer}>
            <Button href={dashboardUrl} style={button}>
              View Team Members
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            You can manage team members and their roles in your dashboard.
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

export default InvitationAcceptedEmail;
