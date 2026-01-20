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

interface WelcomeEmailProps {
  userName: string;
  appUrl?: string;
}

export function WelcomeEmail({
  userName,
  appUrl = "https://app.drovi.io",
}: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Drovi - Let's get started!</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Welcome to Drovi!</Heading>
          <Text style={text}>Hi {userName},</Text>
          <Text style={text}>
            We're excited to have you on board! Drovi helps you turn your email
            into actionable intelligence with AI-powered insights.
          </Text>
          <Section style={buttonContainer}>
            <Button href={`${appUrl}/dashboard`} style={button}>
              Go to Dashboard
            </Button>
          </Section>
          <Text style={text}>Here's what you can do next:</Text>
          <ul style={list}>
            <li style={listItem}>Create your first organization</li>
            <li style={listItem}>Invite your team members</li>
            <li style={listItem}>Explore our features</li>
          </ul>
          <Hr style={hr} />
          <Text style={footer}>
            If you have any questions, feel free to{" "}
            <Link href="mailto:support@drovi.io" style={link}>
              contact our support team
            </Link>
            .
          </Text>
          <Text style={footer}>
            Best regards,
            <br />
            The Drovi Team
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

const list = {
  marginTop: "16px",
  marginBottom: "16px",
  paddingLeft: "24px",
};

const listItem = {
  color: "#374151",
  fontSize: "16px",
  lineHeight: "1.5",
  marginBottom: "8px",
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
  color: "#000000",
  textDecoration: "underline",
};

export default WelcomeEmail;
