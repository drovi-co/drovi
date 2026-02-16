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
    "/login": {
      id: "/login";
      path: "/login";
      fullPath: "/login";
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
    "/dashboard/jobs": {
      id: "/dashboard/jobs";
      path: "/jobs";
      fullPath: "/dashboard/jobs";
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
    "/dashboard/governance": {
      id: "/dashboard/governance";
      path: "/governance";
      fullPath: "/dashboard/governance";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/connectors": {
      id: "/dashboard/connectors";
      path: "/connectors";
      fullPath: "/dashboard/connectors";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/users/": {
      id: "/dashboard/users/";
      path: "/users";
      fullPath: "/dashboard/users";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/tickets/": {
      id: "/dashboard/tickets/";
      path: "/tickets";
      fullPath: "/dashboard/tickets";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/orgs/": {
      id: "/dashboard/orgs/";
      path: "/orgs";
      fullPath: "/dashboard/orgs";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/users/$userId": {
      id: "/dashboard/users/$userId";
      path: "/users/$userId";
      fullPath: "/dashboard/users/$userId";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/tickets/$ticketId": {
      id: "/dashboard/tickets/$ticketId";
      path: "/tickets/$ticketId";
      fullPath: "/dashboard/tickets/$ticketId";
      preLoaderRoute: any;
      parentRoute: any;
    };
    "/dashboard/orgs/$orgId": {
      id: "/dashboard/orgs/$orgId";
      path: "/orgs/$orgId";
      fullPath: "/dashboard/orgs/$orgId";
      preLoaderRoute: any;
      parentRoute: any;
    };
  }
}

export {};
