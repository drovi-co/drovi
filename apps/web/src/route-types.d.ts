/* biome-ignore-all lint/suspicious/noExplicitAny: TanStack route type augmentation requires broad placeholders. */
// Manual TanStack route type augmentation.
// This replaces generated routeTree typing while keeping createFileRoute path safety.

declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
    "/": {
      id: "/";
      path: "/";
      fullPath: "/";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/ai": {
      id: "/ai";
      path: "/ai";
      fullPath: "/ai";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/forgot-password": {
      id: "/forgot-password";
      path: "/forgot-password";
      fullPath: "/forgot-password";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/login": {
      id: "/login";
      path: "/login";
      fullPath: "/login";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/reset-password": {
      id: "/reset-password";
      path: "/reset-password";
      fullPath: "/reset-password";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/success": {
      id: "/success";
      path: "/success";
      fullPath: "/success";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/onboarding": {
      id: "/onboarding";
      path: "/onboarding";
      fullPath: "/onboarding";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/onboarding/": {
      id: "/onboarding/";
      path: "/";
      fullPath: "/onboarding";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/onboarding/create-org": {
      id: "/onboarding/create-org";
      path: "/create-org";
      fullPath: "/onboarding/create-org";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/onboarding/invite-team": {
      id: "/onboarding/invite-team";
      path: "/invite-team";
      fullPath: "/onboarding/invite-team";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/onboarding/connect-sources": {
      id: "/onboarding/connect-sources";
      path: "/connect-sources";
      fullPath: "/onboarding/connect-sources";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/onboarding/complete": {
      id: "/onboarding/complete";
      path: "/complete";
      fullPath: "/onboarding/complete";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard": {
      id: "/dashboard";
      path: "/dashboard";
      fullPath: "/dashboard";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/": {
      id: "/dashboard/";
      path: "/";
      fullPath: "/dashboard";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/actuations": {
      id: "/dashboard/actuations";
      path: "/actuations";
      fullPath: "/dashboard/actuations";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/builder": {
      id: "/dashboard/builder";
      path: "/builder";
      fullPath: "/dashboard/builder";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/commitments/": {
      id: "/dashboard/commitments/";
      path: "/commitments";
      fullPath: "/dashboard/commitments";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/commitments/$commitmentId": {
      id: "/dashboard/commitments/$commitmentId";
      path: "/commitments/$commitmentId";
      fullPath: "/dashboard/commitments/$commitmentId";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/console": {
      id: "/dashboard/console";
      path: "/console";
      fullPath: "/dashboard/console";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/contacts/": {
      id: "/dashboard/contacts/";
      path: "/contacts";
      fullPath: "/dashboard/contacts";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/continuums": {
      id: "/dashboard/continuums";
      path: "/continuums";
      fullPath: "/dashboard/continuums";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/decisions/": {
      id: "/dashboard/decisions/";
      path: "/decisions";
      fullPath: "/dashboard/decisions";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/decisions/$decisionId": {
      id: "/dashboard/decisions/$decisionId";
      path: "/decisions/$decisionId";
      fullPath: "/dashboard/decisions/$decisionId";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/drive": {
      id: "/dashboard/drive";
      path: "/drive";
      fullPath: "/dashboard/drive";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/exchange": {
      id: "/dashboard/exchange";
      path: "/exchange";
      fullPath: "/dashboard/exchange";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/graph/": {
      id: "/dashboard/graph/";
      path: "/graph";
      fullPath: "/dashboard/graph";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/patterns/": {
      id: "/dashboard/patterns/";
      path: "/patterns";
      fullPath: "/dashboard/patterns";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/reality-stream/": {
      id: "/dashboard/reality-stream/";
      path: "/reality-stream";
      fullPath: "/dashboard/reality-stream";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/schedule": {
      id: "/dashboard/schedule";
      path: "/schedule";
      fullPath: "/dashboard/schedule";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/settings": {
      id: "/dashboard/settings";
      path: "/settings";
      fullPath: "/dashboard/settings";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/simulations/": {
      id: "/dashboard/simulations/";
      path: "/simulations";
      fullPath: "/dashboard/simulations";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/sources/": {
      id: "/dashboard/sources/";
      path: "/sources";
      fullPath: "/dashboard/sources";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/tasks/": {
      id: "/dashboard/tasks/";
      path: "/tasks";
      fullPath: "/dashboard/tasks";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/tasks/$taskId": {
      id: "/dashboard/tasks/$taskId";
      path: "/tasks/$taskId";
      fullPath: "/dashboard/tasks/$taskId";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/team/": {
      id: "/dashboard/team/";
      path: "/team";
      fullPath: "/dashboard/team";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/team/invitations": {
      id: "/dashboard/team/invitations";
      path: "/team/invitations";
      fullPath: "/dashboard/team/invitations";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/team/members": {
      id: "/dashboard/team/members";
      path: "/team/members";
      fullPath: "/dashboard/team/members";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/team/settings": {
      id: "/dashboard/team/settings";
      path: "/team/settings";
      fullPath: "/dashboard/team/settings";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/trust": {
      id: "/dashboard/trust";
      path: "/trust";
      fullPath: "/dashboard/trust";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/uio/$uioId": {
      id: "/dashboard/uio/$uioId";
      path: "/uio/$uioId";
      fullPath: "/dashboard/uio/$uioId";
      preLoaderRoute: any;
      parentRoute: any;
    };
  }
}

export {};
