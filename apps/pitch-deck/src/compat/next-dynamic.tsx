import React from "react";

type ModuleWithDefault<T> = { default: T };

function hasDefaultExport<T>(
  value: T | ModuleWithDefault<T>
): value is ModuleWithDefault<T> {
  return Boolean(value && typeof value === "object" && "default" in value);
}

export default function dynamic<TProps = Record<string, never>>(
  loader: () =>
    Promise<
      React.ComponentType<TProps> | ModuleWithDefault<React.ComponentType<TProps>>
    >,
  _options?: { ssr?: boolean }
) {
  const LazyComponent = React.lazy(async () => {
    const loaded = await loader();

    if (hasDefaultExport(loaded)) {
      return loaded;
    }

    return { default: loaded };
  });

  const DynamicComponent = (props: TProps) => (
    <React.Suspense fallback={null}>
      <LazyComponent {...props} />
    </React.Suspense>
  );

  return DynamicComponent;
}
