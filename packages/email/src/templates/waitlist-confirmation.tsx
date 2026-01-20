import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";

interface WaitlistConfirmationEmailProps {
  userName: string;
  appUrl?: string;
}

export function WaitlistConfirmationEmail({
  userName,
  appUrl = "https://drovi.io",
}: WaitlistConfirmationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>We received your Drovi waitlist application!</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>You're on the list!</Heading>
          <Text style={text}>Hi {userName},</Text>
          <Text style={text}>
            Thanks for your interest in Drovi! We've received your application
            and added you to our waitlist.
          </Text>
          <Text style={text}>
            We're carefully reviewing applications to ensure we can provide the
            best experience for our early users. We'll notify you as soon as
            your spot is ready.
          </Text>
          <Text style={highlight}>What happens next?</Text>
          <ul style={list}>
            <li style={listItem}>Our team will review your application</li>
            <li style={listItem}>
              Once approved, you'll receive an exclusive invite code
            </li>
            <li style={listItem}>
              Use the code to create your account and start using Drovi
            </li>
          </ul>
          <Hr style={hr} />
          <Text style={footer}>
            In the meantime, if you have any questions, feel free to reach out
            to us at{" "}
            <Link href="mailto:hello@drovi.io" style={link}>
              hello@drovi.io
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
  color: "#8b5cf6",
  textDecoration: "underline",
};

export default WaitlistConfirmationEmail;
