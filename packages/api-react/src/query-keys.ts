export const queryKeys = {
  auth: {
    me: () => ["auth", "me"] as const,
  },
  org: {
    info: () => ["org", "info"] as const,
    members: () => ["org", "members"] as const,
    invites: () => ["org", "invites"] as const,
    connections: () => ["org", "connections"] as const,
  },
  drive: {
    documents: (organizationId: string) =>
      ["drive", "documents", organizationId] as const,
  },
};
