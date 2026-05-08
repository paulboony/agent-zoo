import { NotificationsSection } from "@/components/settings/notifications-section.js";

export function Settings() {
  return (
    <div className="flex h-full flex-col">
      <div className="p-4">
        <h2 className="font-semibold text-lg">Settings</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <NotificationsSection />
      </div>
    </div>
  );
}
