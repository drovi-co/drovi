export type SseErrorHandler = (error: Event) => void;

export interface SseSubscription {
  close: () => void;
}

export function subscribeJsonEvents<T>(params: {
  url: string;
  withCredentials?: boolean;
  onMessage: (data: T) => void;
  onError?: SseErrorHandler;
}): SseSubscription {
  const eventSource = new EventSource(params.url, {
    withCredentials: params.withCredentials ?? true,
  });

  eventSource.onmessage = (event) => {
    try {
      params.onMessage(JSON.parse(event.data) as T);
    } catch {
      // Ignore parse errors: servers sometimes send keepalive/empty messages.
    }
  };

  eventSource.onerror = (error) => {
    params.onError?.(error);
  };

  return {
    close: () => eventSource.close(),
  };
}

export function subscribeNamedJsonEvents<T>(params: {
  url: string;
  events: string[];
  withCredentials?: boolean;
  onEvent: (event: string, data: T) => void;
  onError?: SseErrorHandler;
}): SseSubscription {
  const eventSource = new EventSource(params.url, {
    withCredentials: params.withCredentials ?? true,
  });

  for (const event of params.events) {
    eventSource.addEventListener(event, (e) => {
      try {
        params.onEvent(event, JSON.parse((e as MessageEvent).data) as T);
      } catch {
        // Ignore parse errors.
      }
    });
  }

  eventSource.onerror = (error) => {
    params.onError?.(error);
  };

  return {
    close: () => eventSource.close(),
  };
}
