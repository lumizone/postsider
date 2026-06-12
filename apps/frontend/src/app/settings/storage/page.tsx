import { redirect } from "next/navigation";

// Storage settings tab removed — redirect any direct navigation back to settings.
export default function StorageSettingsPage() {
  redirect("/settings");
}
