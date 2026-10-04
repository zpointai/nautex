import { lazy, Suspense, type ComponentType } from "react";

type DynamicModule<Props> = ComponentType<Props> | { default: ComponentType<Props> };

export default function dynamic<Props extends object>(loader: () => Promise<DynamicModule<Props>>) {
  const Component = lazy(async () => {
    const loaded = await loader();
    return typeof loaded === "object" && loaded !== null && "default" in loaded
      ? loaded
      : { default: loaded };
  });

  return function DesktopDynamicComponent(props: Props) {
    return <Suspense fallback={null}><Component {...props} /></Suspense>;
  };
}
