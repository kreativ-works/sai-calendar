import { api } from "./api";

/** Stop this browser's deliveries before removing its authenticated session. */
export async function disconnectDevicePushBeforeLogout(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  let registration: ServiceWorkerRegistration | undefined;
  try { registration = await navigator.serviceWorker.getRegistration("/"); }
  catch { return; /* Browsers without usable service workers have no accessible push subscription. */ }
  if (!registration) return;
  const subscription = await registration.pushManager?.getSubscription();
  if (subscription) {
    let detached = false;
    try { await api("/api/notifications/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }); detached = true; }
    catch { /* An expired session still permits browser-side unsubscription. */ }
    try { await subscription.unsubscribe(); detached = true; }
    catch { if (!detached) throw new Error("기기 알림 연결을 해제하지 못했어요. 다시 시도해 주세요."); }
  }
  try { (await registration.getNotifications()).forEach(notice => notice.close()); }
  catch { /* Delivery has already been detached; clearing old OS banners is optional. */ }
}
