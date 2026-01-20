import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface WelcomeEmailProps {
  name: string;
  appName?: string;
}

export default function WelcomeEmail({
  name = "User",
  appName = "SaaS Template",
}: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to {appName}!</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Welcome to {appName}!</Heading>
          <Text style={text}>Hi {name},</Text>
          <Text style={text}>
            Thank you for signing up. We're excited to have you on board!
          </Text>
          <Section style={buttonContainer}>
            <Link
              href={`${process.env.CORS_ORIGIN ?? "https://app.drovi.io"}/dashboard`}
              style={button}
            >
              Go to Dashboard
            </Link>
          </Section>
          <Text style={footer}>
            If you have any questions, feel free to reach out to our support
            team.
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
  padding: "20px 0 48px",
  marginBottom: "64px",
  borderRadius: "5px",
};

const h1 = {
  color: "#333",
  fontSize: "24px",
  fontWeight: "bold",
  margin: "40px 0",
  padding: "0 48px",
};

const text = {
  color: "#555",
  fontSize: "16px",
  lineHeight: "24px",
  padding: "0 48px",
};

const buttonContainer = {
  padding: "27px 48px 27px 48px",
};

const button = {
  backgroundColor: "#000",
  borderRadius: "5px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "bold",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "12px",
};

const footer = {
  color: "#8898aa",
  fontSize: "12px",
  lineHeight: "16px",
  padding: "0 48px",
};
