/* biome-ignore-all lint/suspicious/noExplicitAny: route update options are intentionally cast while migrating away from generated trees */

// Manual route composition for admin app.
// This replaces generated routeTree usage and keeps route paths stable.

import { Route as rootRouteImport } from "./routes/__root";
import { Route as DashboardConnectorsRouteImport } from "./routes/dashboard/connectors";
import { Route as DashboardExchangeRouteImport } from "./routes/dashboard/exchange";
import { Route as DashboardGovernanceRouteImport } from "./routes/dashboard/governance";
import { Route as DashboardIndexRouteImport } from "./routes/dashboard/index";
import { Route as DashboardJobsRouteImport } from "./routes/dashboard/jobs";
import { Route as DashboardOrgsOrgIdRouteImport } from "./routes/dashboard/orgs/$orgId";
import { Route as DashboardOrgsIndexRouteImport } from "./routes/dashboard/orgs/index";
import { Route as DashboardRouteRouteImport } from "./routes/dashboard/route";
import { Route as DashboardTicketsTicketIdRouteImport } from "./routes/dashboard/tickets/$ticketId";
import { Route as DashboardTicketsIndexRouteImport } from "./routes/dashboard/tickets/index";
import { Route as DashboardUsersUserIdRouteImport } from "./routes/dashboard/users/$userId";
import { Route as DashboardUsersIndexRouteImport } from "./routes/dashboard/users/index";
import { Route as IndexRouteImport } from "./routes/index";
import { Route as LoginRouteImport } from "./routes/login";

const LoginRoute = LoginRouteImport.update({
  id: "/login",
  path: "/login",
  getParentRoute: () => rootRouteImport,
} as any);
const DashboardRouteRoute = DashboardRouteRouteImport.update({
  id: "/dashboard",
  path: "/dashboard",
  getParentRoute: () => rootRouteImport,
} as any);
const IndexRoute = IndexRouteImport.update({
  id: "/",
  path: "/",
  getParentRoute: () => rootRouteImport,
} as any);
const DashboardIndexRoute = DashboardIndexRouteImport.update({
  id: "/",
  path: "/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardJobsRoute = DashboardJobsRouteImport.update({
  id: "/jobs",
  path: "/jobs",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardExchangeRoute = DashboardExchangeRouteImport.update({
  id: "/exchange",
  path: "/exchange",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardGovernanceRoute = DashboardGovernanceRouteImport.update({
  id: "/governance",
  path: "/governance",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardConnectorsRoute = DashboardConnectorsRouteImport.update({
  id: "/connectors",
  path: "/connectors",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardUsersIndexRoute = DashboardUsersIndexRouteImport.update({
  id: "/users/",
  path: "/users/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardTicketsIndexRoute = DashboardTicketsIndexRouteImport.update({
  id: "/tickets/",
  path: "/tickets/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardOrgsIndexRoute = DashboardOrgsIndexRouteImport.update({
  id: "/orgs/",
  path: "/orgs/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardUsersUserIdRoute = DashboardUsersUserIdRouteImport.update({
  id: "/users/$userId",
  path: "/users/$userId",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardTicketsTicketIdRoute =
  DashboardTicketsTicketIdRouteImport.update({
    id: "/tickets/$ticketId",
    path: "/tickets/$ticketId",
    getParentRoute: () => DashboardRouteRoute,
  } as any);
const DashboardOrgsOrgIdRoute = DashboardOrgsOrgIdRouteImport.update({
  id: "/orgs/$orgId",
  path: "/orgs/$orgId",
  getParentRoute: () => DashboardRouteRoute,
} as any);

const DashboardRouteRouteWithChildren = DashboardRouteRoute.addChildren([
  DashboardIndexRoute,
  DashboardJobsRoute,
  DashboardExchangeRoute,
  DashboardGovernanceRoute,
  DashboardConnectorsRoute,
  DashboardUsersIndexRoute,
  DashboardTicketsIndexRoute,
  DashboardOrgsIndexRoute,
  DashboardUsersUserIdRoute,
  DashboardTicketsTicketIdRoute,
  DashboardOrgsOrgIdRoute,
]);

export const routeTree = rootRouteImport.addChildren([
  IndexRoute,
  DashboardRouteRouteWithChildren,
  LoginRoute,
]);
