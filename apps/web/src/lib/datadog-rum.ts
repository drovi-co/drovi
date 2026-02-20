import { env } from "@memorystack/env/web";
import { datadogRum } from "@datadog/browser-rum";
import { reactPlugin } from "@datadog/browser-rum-react";

const DEFAULT_APPLICATION_ID = "2958c2a2-a53b-420c-afbe-e55f56cb9d6d";
const DEFAULT_CLIENT_TOKEN = "pub166b65bfb9cd33e4782a2ffad866b4b2";

let initialized = false;

export function initDatadogRum() {
  if (initialized || !env.VITE_DATADOG_RUM_ENABLED) {
    return;
  }

  if (import.meta.env.DEV && !env.VITE_DATADOG_RUM_ENABLE_IN_DEV) {
    return;
  }

  const applicationId =
    env.VITE_DATADOG_RUM_APPLICATION_ID || DEFAULT_APPLICATION_ID;
  const clientToken = env.VITE_DATADOG_RUM_CLIENT_TOKEN || DEFAULT_CLIENT_TOKEN;

  if (!applicationId || !clientToken) {
    return;
  }

  const environment =
    env.VITE_DATADOG_RUM_ENV ||
    env.VITE_SENTRY_ENVIRONMENT ||
    import.meta.env.MODE;
  const version =
    env.VITE_APP_VERSION || env.VITE_GIT_SHA || import.meta.env.MODE;

  datadogRum.init({
    applicationId,
    clientToken,
    site: env.VITE_DATADOG_SITE,
    service: env.VITE_DATADOG_RUM_SERVICE,
    env: environment,
    version,
    sessionSampleRate: 100,
    sessionReplaySampleRate: 20,
    trackResources: true,
    trackUserInteractions: true,
    trackLongTasks: true,
    plugins: [reactPlugin({ router: false })],
  });

  initialized = true;
}
