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

interface MagicLinkEmailProps {
  magicLink: string;
  expiresIn?: string;
}

export function MagicLinkEmail({
  magicLink,
  expiresIn = "15 minutes",
}: MagicLinkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your sign-in link for MemoryStack</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Sign in to MemoryStack</Heading>
          <Text style={text}>
            Click the button below to sign in to your MemoryStack account. This
            link will expire in {expiresIn}.
          </Text>
          <Section style={buttonContainer}>
            <Button href={magicLink} style={button}>
              Sign in to MemoryStack
            </Button>
          </Section>
          <Text style={text}>
            If you didn't request this email, you can safely ignore it.
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            If the button doesn't work, copy and paste this link into your
            browser:
          </Text>
          <Text style={linkText}>{magicLink}</Text>
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

export default MagicLinkEmail;
