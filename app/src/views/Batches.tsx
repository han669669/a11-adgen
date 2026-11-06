import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { api, type BatchRow } from "@/lib/api";

const STATUS_LABEL: Record<string, string> = {
  research: "Research",
  ideas: "Ideas",
  drafts: "Drafts",
  board: "Ready for your pick",
  finals: "Finals",
  done: "Done",
};

export function Batches() {
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<BatchRow[]>("/api/batches").then(setRows, (e) => setError((e as Error).message));
  }, []);

  if (error) return <p className="text-body text-red-700">{error}</p>;
  if (!rows) return <p className="text-body text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-body text-muted-foreground">No batches yet. Claude makes them through the MCP server.</p>;

  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {rows.map((b) => (
        <li key={b.id}>
          <a href={`#/b/${b.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-hover">
            <span>
              <span className="text-subtitle font-medium">{b.brandName}</span>
              <span className="ml-2 text-body text-muted-foreground">{b.label}</span>
            </span>
            <span className="flex items-center gap-3">
              <Badge variant={b.status === "board" ? "solid" : "dot"}>{STATUS_LABEL[b.status] ?? b.status}</Badge>
              <span className="text-caption text-muted-foreground">{new Date(b.createdAt).toLocaleDateString("en-GB", { timeZone: "Asia/Singapore" })}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
