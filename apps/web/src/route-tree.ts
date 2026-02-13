/* biome-ignore-all lint/suspicious/noExplicitAny: route update options are intentionally cast while migrating away from generated trees */

// Manual route composition for web app.
// This replaces generated routeTree usage and keeps route paths stable.

import { Route as rootRouteImport } from "./routes/__root";
import { Route as AiRouteImport } from "./routes/ai";
import { Route as DashboardActuationsRouteImport } from "./routes/dashboard/actuations";
import { Route as DashboardBuilderRouteImport } from "./routes/dashboard/builder";
import { Route as DashboardCommitmentsCommitmentIdRouteImport } from "./routes/dashboard/commitments/$commitmentId";
import { Route as DashboardCommitmentsIndexRouteImport } from "./routes/dashboard/commitments/index";
import { Route as DashboardConsoleRouteImport } from "./routes/dashboard/console";
import { Route as DashboardContactsIndexRouteImport } from "./routes/dashboard/contacts/index";
import { Route as DashboardContinuumsRouteImport } from "./routes/dashboard/continuums";
import { Route as DashboardDecisionsDecisionIdRouteImport } from "./routes/dashboard/decisions/$decisionId";
import { Route as DashboardDecisionsIndexRouteImport } from "./routes/dashboard/decisions/index";
import { Route as DashboardDriveRouteImport } from "./routes/dashboard/drive";
import { Route as DashboardExchangeRouteImport } from "./routes/dashboard/exchange";
import { Route as DashboardGraphIndexRouteImport } from "./routes/dashboard/graph/index";
import { Route as DashboardIndexRouteImport } from "./routes/dashboard/index";
import { Route as DashboardPatternsIndexRouteImport } from "./routes/dashboard/patterns/index";
import { Route as DashboardRealityStreamIndexRouteImport } from "./routes/dashboard/reality-stream/index";
import { Route as DashboardRouteRouteImport } from "./routes/dashboard/route";
import { Route as DashboardScheduleRouteImport } from "./routes/dashboard/schedule";
import { Route as DashboardSettingsRouteImport } from "./routes/dashboard/settings";
import { Route as DashboardSimulationsIndexRouteImport } from "./routes/dashboard/simulations/index";
import { Route as DashboardSourcesIndexRouteImport } from "./routes/dashboard/sources/index";
import { Route as DashboardTasksTaskIdRouteImport } from "./routes/dashboard/tasks/$taskId";
import { Route as DashboardTasksIndexRouteImport } from "./routes/dashboard/tasks/index";
import { Route as DashboardTeamIndexRouteImport } from "./routes/dashboard/team/index";
import { Route as DashboardTeamInvitationsRouteImport } from "./routes/dashboard/team/invitations";
import { Route as DashboardTeamMembersRouteImport } from "./routes/dashboard/team/members";
import { Route as DashboardTeamSettingsRouteImport } from "./routes/dashboard/team/settings";
import { Route as DashboardTrustRouteImport } from "./routes/dashboard/trust";
import { Route as DashboardUioUioIdRouteImport } from "./routes/dashboard/uio/$uioId";
import { Route as ForgotPasswordRouteImport } from "./routes/forgot-password";
import { Route as IndexRouteImport } from "./routes/index";
import { Route as LoginRouteImport } from "./routes/login";
import { Route as OnboardingCompleteRouteImport } from "./routes/onboarding/complete";
import { Route as OnboardingConnectSourcesRouteImport } from "./routes/onboarding/connect-sources";
import { Route as OnboardingCreateOrgRouteImport } from "./routes/onboarding/create-org";
import { Route as OnboardingIndexRouteImport } from "./routes/onboarding/index";
import { Route as OnboardingInviteTeamRouteImport } from "./routes/onboarding/invite-team";
import { Route as OnboardingRouteRouteImport } from "./routes/onboarding/route";
import { Route as ResetPasswordRouteImport } from "./routes/reset-password";
import { Route as SuccessRouteImport } from "./routes/success";

const SuccessRoute = SuccessRouteImport.update({
  id: "/success",
  path: "/success",
  getParentRoute: () => rootRouteImport,
} as any);
const ResetPasswordRoute = ResetPasswordRouteImport.update({
  id: "/reset-password",
  path: "/reset-password",
  getParentRoute: () => rootRouteImport,
} as any);
const LoginRoute = LoginRouteImport.update({
  id: "/login",
  path: "/login",
  getParentRoute: () => rootRouteImport,
} as any);
const ForgotPasswordRoute = ForgotPasswordRouteImport.update({
  id: "/forgot-password",
  path: "/forgot-password",
  getParentRoute: () => rootRouteImport,
} as any);
const AiRoute = AiRouteImport.update({
  id: "/ai",
  path: "/ai",
  getParentRoute: () => rootRouteImport,
} as any);
const OnboardingRouteRoute = OnboardingRouteRouteImport.update({
  id: "/onboarding",
  path: "/onboarding",
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
const OnboardingIndexRoute = OnboardingIndexRouteImport.update({
  id: "/",
  path: "/",
  getParentRoute: () => OnboardingRouteRoute,
} as any);
const DashboardIndexRoute = DashboardIndexRouteImport.update({
  id: "/",
  path: "/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const OnboardingInviteTeamRoute = OnboardingInviteTeamRouteImport.update({
  id: "/invite-team",
  path: "/invite-team",
  getParentRoute: () => OnboardingRouteRoute,
} as any);
const OnboardingCreateOrgRoute = OnboardingCreateOrgRouteImport.update({
  id: "/create-org",
  path: "/create-org",
  getParentRoute: () => OnboardingRouteRoute,
} as any);
const OnboardingConnectSourcesRoute =
  OnboardingConnectSourcesRouteImport.update({
    id: "/connect-sources",
    path: "/connect-sources",
    getParentRoute: () => OnboardingRouteRoute,
  } as any);
const OnboardingCompleteRoute = OnboardingCompleteRouteImport.update({
  id: "/complete",
  path: "/complete",
  getParentRoute: () => OnboardingRouteRoute,
} as any);
const DashboardTrustRoute = DashboardTrustRouteImport.update({
  id: "/trust",
  path: "/trust",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardSettingsRoute = DashboardSettingsRouteImport.update({
  id: "/settings",
  path: "/settings",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardScheduleRoute = DashboardScheduleRouteImport.update({
  id: "/schedule",
  path: "/schedule",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardExchangeRoute = DashboardExchangeRouteImport.update({
  id: "/exchange",
  path: "/exchange",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardDriveRoute = DashboardDriveRouteImport.update({
  id: "/drive",
  path: "/drive",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardContinuumsRoute = DashboardContinuumsRouteImport.update({
  id: "/continuums",
  path: "/continuums",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardConsoleRoute = DashboardConsoleRouteImport.update({
  id: "/console",
  path: "/console",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardBuilderRoute = DashboardBuilderRouteImport.update({
  id: "/builder",
  path: "/builder",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardActuationsRoute = DashboardActuationsRouteImport.update({
  id: "/actuations",
  path: "/actuations",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardTeamIndexRoute = DashboardTeamIndexRouteImport.update({
  id: "/team/",
  path: "/team/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardTasksIndexRoute = DashboardTasksIndexRouteImport.update({
  id: "/tasks/",
  path: "/tasks/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardSourcesIndexRoute = DashboardSourcesIndexRouteImport.update({
  id: "/sources/",
  path: "/sources/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardSimulationsIndexRoute =
  DashboardSimulationsIndexRouteImport.update({
    id: "/simulations/",
    path: "/simulations/",
    getParentRoute: () => DashboardRouteRoute,
  } as any);
const DashboardRealityStreamIndexRoute =
  DashboardRealityStreamIndexRouteImport.update({
    id: "/reality-stream/",
    path: "/reality-stream/",
    getParentRoute: () => DashboardRouteRoute,
  } as any);
const DashboardPatternsIndexRoute = DashboardPatternsIndexRouteImport.update({
  id: "/patterns/",
  path: "/patterns/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardGraphIndexRoute = DashboardGraphIndexRouteImport.update({
  id: "/graph/",
  path: "/graph/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardDecisionsIndexRoute = DashboardDecisionsIndexRouteImport.update({
  id: "/decisions/",
  path: "/decisions/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardContactsIndexRoute = DashboardContactsIndexRouteImport.update({
  id: "/contacts/",
  path: "/contacts/",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardCommitmentsIndexRoute =
  DashboardCommitmentsIndexRouteImport.update({
    id: "/commitments/",
    path: "/commitments/",
    getParentRoute: () => DashboardRouteRoute,
  } as any);
const DashboardUioUioIdRoute = DashboardUioUioIdRouteImport.update({
  id: "/uio/$uioId",
  path: "/uio/$uioId",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardTeamSettingsRoute = DashboardTeamSettingsRouteImport.update({
  id: "/team/settings",
  path: "/team/settings",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardTeamMembersRoute = DashboardTeamMembersRouteImport.update({
  id: "/team/members",
  path: "/team/members",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardTeamInvitationsRoute =
  DashboardTeamInvitationsRouteImport.update({
    id: "/team/invitations",
    path: "/team/invitations",
    getParentRoute: () => DashboardRouteRoute,
  } as any);
const DashboardTasksTaskIdRoute = DashboardTasksTaskIdRouteImport.update({
  id: "/tasks/$taskId",
  path: "/tasks/$taskId",
  getParentRoute: () => DashboardRouteRoute,
} as any);
const DashboardDecisionsDecisionIdRoute =
  DashboardDecisionsDecisionIdRouteImport.update({
    id: "/decisions/$decisionId",
    path: "/decisions/$decisionId",
    getParentRoute: () => DashboardRouteRoute,
  } as any);
const DashboardCommitmentsCommitmentIdRoute =
  DashboardCommitmentsCommitmentIdRouteImport.update({
    id: "/commitments/$commitmentId",
    path: "/commitments/$commitmentId",
    getParentRoute: () => DashboardRouteRoute,
  } as any);

const OnboardingRouteRouteWithChildren = OnboardingRouteRoute.addChildren([
  OnboardingIndexRoute,
  OnboardingInviteTeamRoute,
  OnboardingCreateOrgRoute,
  OnboardingConnectSourcesRoute,
  OnboardingCompleteRoute,
]);

const DashboardRouteRouteWithChildren = DashboardRouteRoute.addChildren([
  DashboardIndexRoute,
  DashboardTrustRoute,
  DashboardSettingsRoute,
  DashboardScheduleRoute,
  DashboardExchangeRoute,
  DashboardDriveRoute,
  DashboardContinuumsRoute,
  DashboardConsoleRoute,
  DashboardBuilderRoute,
  DashboardActuationsRoute,
  DashboardTeamIndexRoute,
  DashboardTasksIndexRoute,
  DashboardSourcesIndexRoute,
  DashboardSimulationsIndexRoute,
  DashboardRealityStreamIndexRoute,
  DashboardPatternsIndexRoute,
  DashboardGraphIndexRoute,
  DashboardDecisionsIndexRoute,
  DashboardContactsIndexRoute,
  DashboardCommitmentsIndexRoute,
  DashboardUioUioIdRoute,
  DashboardTeamSettingsRoute,
  DashboardTeamMembersRoute,
  DashboardTeamInvitationsRoute,
  DashboardTasksTaskIdRoute,
  DashboardDecisionsDecisionIdRoute,
  DashboardCommitmentsCommitmentIdRoute,
]);

export const routeTree = rootRouteImport.addChildren([
  IndexRoute,
  DashboardRouteRouteWithChildren,
  OnboardingRouteRouteWithChildren,
  AiRoute,
  ForgotPasswordRoute,
  LoginRoute,
  ResetPasswordRoute,
  SuccessRoute,
]);
