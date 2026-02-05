import { z } from "zod";

// User schema
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional().nullable(),
  avatar_url: z.string().url().optional().nullable(),
  role: z.string().optional(), // pilot_admin, pilot_member, admin, member, viewer
  created_at: z.string(),
});

// Organization schema
export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "trial", "suspended"]).optional(),
  region: z.string().optional(),
  created_at: z.string(),
});

// Login initiate response (OAuth)
export const LoginInitiateResponseSchema = z.object({
  auth_url: z.string().url(),
  state: z.string(),
  code_verifier: z.string().optional(),
});

// Email login request
export const EmailLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Email signup request
export const EmailSignupRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

// Email auth response
export const EmailAuthResponseSchema = z.object({
  user: z.lazy(() => UserSchema),
  session_token: z.string(),
  organization: z.lazy(() => OrganizationSchema).optional(),
  organizations: z.array(z.lazy(() => OrganizationSchema)).optional(),
});

// Auth me response
export const AuthMeResponseSchema = z.object({
  user: UserSchema,
  organization: OrganizationSchema.optional(),
  organizations: z.array(OrganizationSchema).optional(),
  session_expires_at: z.string().optional(),
});

// Session schema
export const SessionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  organization_id: z.string().optional(),
  expires_at: z.string(),
  created_at: z.string(),
});

// Organization info response
export const OrgInfoResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().optional(),
  region: z.string().optional(),
  domains: z.array(z.string()).optional(),
  member_count: z.number().optional(),
  connection_count: z.number().optional(),
  created_at: z.string(),
});

export type User = z.infer<typeof UserSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type LoginInitiateResponse = z.infer<typeof LoginInitiateResponseSchema>;
export type EmailLoginRequest = z.infer<typeof EmailLoginRequestSchema>;
export type EmailSignupRequest = z.infer<typeof EmailSignupRequestSchema>;
export type EmailAuthResponse = z.infer<typeof EmailAuthResponseSchema>;
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type OrgInfoResponse = z.infer<typeof OrgInfoResponseSchema>;
