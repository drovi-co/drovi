"use client";

import { createAuthClient } from "better-auth/react";

const getServerUrl = () => {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000";
  }
  return process.env.SERVER_URL || "http://localhost:3000";
};

export const authClient = createAuthClient({
  baseURL: getServerUrl(),
});

export const { useSession, signIn, signOut } = authClient;
