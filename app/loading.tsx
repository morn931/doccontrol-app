import { CoreflowLoadingScreen } from "@/components/coreflow-spinner";

// Shown automatically while any route in this app loads; the gear appears
// only after 400ms so fast screens never flash it.
export default function Loading() {
  return <CoreflowLoadingScreen fullScreen />;
}
