import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const deleted = await db.backtestPreset.deleteMany({ where: { id } });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "Preset not found." }, { status: 404 });
    }
    return NextResponse.json({ removed: true });
  } catch (err) {
    console.error("DELETE /api/backtest/presets/[id] failed:", err);
    return NextResponse.json({ error: "Could not delete the preset." }, { status: 500 });
  }
}
