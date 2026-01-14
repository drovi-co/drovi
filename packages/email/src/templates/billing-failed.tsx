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

interface BillingFailedEmailProps {
  userName: string;
  planName: string;
  amount: string;
  retryDate?: string;
  billingUrl?: string;
}

export function BillingFailedEmail({
  userName,
  planName,
  amount,
  retryDate,
  billingUrl = "https://app.memorystack.app/dashboard/billing",
}: BillingFailedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Action required: Payment failed for your {planName} plan
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Payment Failed</Heading>
          <Text style={text}>Hi {userName},</Text>
          <Text style={text}>
            We were unable to process your payment of <strong>{amount}</strong>{" "}
            for your <strong>{planName}</strong> subscription.
          </Text>
          {retryDate && (
            <Text style={text}>
              We'll automatically retry the payment on {retryDate}. To avoid any
              service interruption, please update your payment method before
              then.
            </Text>
          )}
          <Section style={buttonContainer}>
            <Button href={billingUrl} style={button}>
              Update Payment Method
            </Button>
          </Section>
          <Text style={text}>
            If you have any questions or need assistance, please don't hesitate
            to contact our support team.
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            If you believe this is an error, please check with your bank or card
            issuer.
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
  color: "#dc2626",
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

export default BillingFailedEmail;
