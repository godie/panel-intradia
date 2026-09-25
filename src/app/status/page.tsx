"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTickStream } from "@/hooks/use-tick-stream";
import { useOrderBook } from "@/hooks/use-order-book";
import { buildGatewaySocketTarget } from "@/lib/socket-url";
import {
  diagnose,
  formatUptime,
  type Diagnosis,
  type ServiceStatus,
  type StatusResponse,
} from "@/lib/status";
import { useLanguage } from "@/hooks/use-language";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Radio,
  RefreshCw,
  XCircle,
} from "lucide-react";

const POLL_MS = 10_000;

const DIAG_STYLE: Record<Diagnosis, { color: string; key: string }> = {
  ok: { color: "#5fbf8f", key: "status.diagOk" },
  gateway: { color: "#e8b04b", key: "status.diagGateway" },
  server_blind: { color: "#e8b04b", key: "status.diagServerBlind" },
  down: { color: "#e2604f", key: "status.diagDown" },
};

function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 text-[11px] last:border-0">
      <span className="shrink-0 text-muted-foreground/60">{label}</span>
      <span
        className="tnum truncate text-right font-medium"
        style={color ? { color } : undefined}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function ReachBadge({ reachable }: { reachable: boolean }) {
  const { t } = useLanguage();
  return reachable ? (
    <span className="inline-flex items-center gap-1 rounded border border-[#5fbf8f]/30 bg-[#5fbf8f]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#5fbf8f]">
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      {t("status.reachable")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded border border-[#e2604f]/30 bg-[#e2604f]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#e2604f]">
      <XCircle className="h-3 w-3" aria-hidden />
      {t("status.unreachable")}
    </span>
  );
}

function ServiceCard({ service }: { service: ServiceStatus }) {
  const { t } = useLanguage();
  const nd = t("card.notAvailable");
  const h = service.health;

  return (
    <article className="rounded-xl border border-white/8 bg-card/60 p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#4fa8d8]" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            {service.id}
          </span>
        </div>
        <ReachBadge reachable={service.reachable} />
      </header>

      <Row label={t("status.upstream")} value={service.target} />
      <Row label="env" value={service.envVar} />
      <Row
        label={t("status.latency")}
        value={service.latencyMs != null ? `${service.latencyMs} ms` : nd}
      />

      {h ? (
        <>
          <Row label={t("status.port")} value={h.port != null ? String(h.port) : nd} />
          <Row
            label={t("status.activeSource")}
            value={h.activeSource ?? nd}
            color="#4fa8d8"
          />
          <Row
            label="binance"
            value={h.binanceConnected ? t("status.connected") : t("status.disconnected")}
            color={h.binanceConnected ? "#5fbf8f" : "#e2604f"}
          />
          <Row
            label="bybit"
            value={h.bybitConnected ? t("status.connected") : t("status.disconnected")}
            color={h.bybitConnected ? "#5fbf8f" : "#8b96a5"}
          />
          <Row label={t("status.clients")} value={String(h.clients)} />
          <Row label={t("status.uptime")} value={formatUptime(h.uptime)} />
        </>
      ) : (
        <Row
          label={t("status.error")}
          value={service.error ?? nd}
          color="#e2604f"
        />
      )}
    </article>
  );
}

export default function StatusPage() {
  const { t } = useLanguage();
  const tick = useTickStream();
  const book = useOrderBook();

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Resolved in an effect: the socket URL depends on window.location, which
  // doesn't exist during SSR.
  const [urls, setUrls] = useState<{ tick: string; book: string } | null>(null);

  const load = useCallback(async (manual: boolean) => {
    if (manual) setBusy(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as StatusResponse);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      if (manual) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const id = setInterval(() => void load(false), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const tickTarget = buildGatewaySocketTarget("3005", window.location);
    const bookTarget = buildGatewaySocketTarget("3004", window.location);
    setUrls({
      tick: `${tickTarget.url}${tickTarget.path}`,
      book: `${bookTarget.url}${bookTarget.path}`,
    });
  }, []);

  const diag = status ? diagnose(status.ok, tick.connected, book.connected) : null;
  const diagStyle = diag ? DIAG_STYLE[diag] : null;
  const snapshots = Object.keys(book.snapshots).length;

  return (
    <div className="relative flex min-h-screen flex-col bg-background terminal-grid">
      <div className="terminal-scanlines pointer-events-none fixed inset-0 z-0" aria-hidden />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="border-b border-white/5 bg-card/40 backdrop-blur-sm">
          <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {t("status.title")}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("status.subtitle")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md border border-[#4fa8d8]/30 bg-[#4fa8d8]/10 px-3 py-1.5 text-xs font-medium text-[#4fa8d8] transition-colors hover:bg-[#4fa8d8]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8] disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
                  aria-hidden
                />
                {t("status.refresh")}
              </button>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                {t("compare.back")}
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {/* Diagnosis — the one conclusion that matters */}
          {diagStyle && (
            <section
              className="rounded-xl border p-4 text-sm"
              style={{
                borderColor: `${diagStyle.color}55`,
                backgroundColor: `${diagStyle.color}12`,
                color: diagStyle.color,
              }}
              role="status"
            >
              {t(diagStyle.key)}
            </section>
          )}

          {error && (
            <section className="rounded-xl border border-[#e2604f]/30 bg-[#e2604f]/10 p-4 text-sm text-[#e2604f]">
              {t("status.error")}: {error}
            </section>
          )}

          {/* Server-side probe */}
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-foreground/70">
                {t("status.serverProbe")}
              </h2>
              {status && (
                <span className="text-[10px] text-muted-foreground/60">
                  {t("status.checkedAt")}: {new Date(status.checkedAt).toLocaleTimeString("es-ES", { timeZone: "UTC" })} UTC
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {status
                ? status.services.map((s) => <ServiceCard key={s.id} service={s} />)
                : [0, 1].map((i) => (
                    <div
                      key={i}
                      className="h-56 animate-pulse rounded-xl border border-white/8 bg-card/40"
                    />
                  ))}
            </div>
          </section>

          {/* Browser-side sockets */}
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-foreground/70">
              {t("status.browser")}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <article className="rounded-xl border border-white/8 bg-card/60 p-4">
                <header className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-[#4fa8d8]" aria-hidden />
                    <span className="text-sm font-semibold tracking-tight text-foreground">
                      tick-stream
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      tick.connected ? "text-[#5fbf8f]" : "text-[#e2604f]"
                    }`}
                  >
                    {tick.connected ? t("status.connected") : t("status.disconnected")}
                  </span>
                </header>
                <Row
                  label={t("status.upstreamLive")}
                  value={tick.binanceLive ? t("status.connected") : t("status.disconnected")}
                  color={tick.binanceLive ? "#5fbf8f" : "#8b96a5"}
                />
                <Row label={t("status.activeSource")} value={tick.source ?? t("card.notAvailable")} />
                <Row label={t("status.ticks")} value={String(tick.tickCount)} />
                <Row
                  label={t("status.lastHeartbeat")}
                  value={
                    tick.lastHeartbeat
                      ? new Date(tick.lastHeartbeat).toLocaleTimeString("es-ES", { timeZone: "UTC" })
                      : t("card.notAvailable")
                  }
                />
                <Row label={t("status.socketUrl")} value={urls?.tick ?? "…"} />
              </article>

              <article className="rounded-xl border border-white/8 bg-card/60 p-4">
                <header className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-[#4fa8d8]" aria-hidden />
                    <span className="text-sm font-semibold tracking-tight text-foreground">
                      order-book
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      book.connected ? "text-[#5fbf8f]" : "text-[#e2604f]"
                    }`}
                  >
                    {book.connected ? t("status.connected") : t("status.disconnected")}
                  </span>
                </header>
                <Row
                  label={t("status.upstreamLive")}
                  value={book.binanceLive ? t("status.connected") : t("status.disconnected")}
                  color={book.binanceLive ? "#5fbf8f" : "#8b96a5"}
                />
                <Row label={t("status.activeSource")} value={book.source ?? t("card.notAvailable")} />
                <Row label={t("status.snapshots")} value={String(snapshots)} />
                <Row label={t("status.socketUrl")} value={urls?.book ?? "…"} />
              </article>
            </div>
          </section>
        </main>

        <footer className="mt-auto border-t border-white/8 bg-black/50">
          <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-4 text-center text-[11px] sm:px-6 md:flex-row md:items-center md:justify-between md:text-left lg:px-8">
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground/80">{t("footer.name")}</span> — {t("footer.tagline")}
            </p>
            <p className="font-medium text-foreground/70">{t("footer.disclaimer")}</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
