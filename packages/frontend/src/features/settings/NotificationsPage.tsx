import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDate, formatDateTime, getArray, getString } from "../lib/domain";
import type { DateFormat, Locale, TemperatureUnit, WeightUnit } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";
export function NotificationsPage({ locale, navigate }: { locale: Locale; navigate: (path: string) => void }) {
  const t = (key: string) => translate(locale, key);
  const [page, setPage] = useState(1);
  const resource = useResource<{ notifications: NotificationDto[]; unreadCount: number; pagination: { page: number; totalPages: number; total: number } }>(`/notifications?page=${page}&pageSize=25`);
  const { toast, show } = useToast();
  async function markRead(item: NotificationDto) {
    try { await api.patch(`/notifications/${getString(item, "id")}/read`, {}); resource.reload(); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  async function readAll() {
    try { await api.post("/notifications/read-all"); resource.reload(); show(t("saveSuccess")); }
    catch (reason) { show(reason instanceof ApiError ? reason.message : t("operationFailed")); }
  }
  return <div className="page-stack">
    <PageHeader eyebrow={t("navWorkspace")} title={t("notificationsTitle")} description={`${resource.data?.unreadCount ?? 0} ${t("unread")}`} action={<div className="inline-actions"><Button variant="secondary" onClick={() => navigate("/settings/notifications")}>{t("notificationPreferences")}</Button><Button onClick={() => void readAll()}><Icon name="checkCircle" />{t("markAllRead")}</Button></div>} />
    <Panel>{resource.loading && !resource.data ? <LoadingState /> : resource.error ? <ErrorState message={resource.error.message} retry={resource.reload} /> : resource.data?.notifications.length ? <div className="notification-list">
      {resource.data.notifications.map((item) => <div className={`notification-row ${item.readAt ? "is-read" : "is-unread"}`} key={getString(item, "id")}><span className="notification-symbol"><Icon name="bell" /></span><button className="notification-copy" onClick={() => { const target = getString(item, "targetPath"); if (target) navigate(target); if (!item.readAt) void markRead(item); }}><strong>{getString(item, "title")}</strong><p>{getString(item, "body")}</p><small>{formatDateTime(getString(item, "createdAt"), locale)}</small></button>{!item.readAt && <Button variant="ghost" size="sm" onClick={() => void markRead(item)}>{t("markRead")}</Button>}</div>)}
    </div> : <EmptyState title={t("noNotifications")} />}
      {resource.data?.pagination && <div className="pagination"><span>{t("page")} {page} / {resource.data.pagination.totalPages}</span><div><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</Button><Button variant="secondary" size="sm" disabled={page >= resource.data!.pagination.totalPages} onClick={() => setPage(page + 1)}>→</Button></div></div>}
    </Panel>
    {toast}
  </div>;
}