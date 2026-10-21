/**
 * /api/backtest/presets — CRUD ligero de presets de configuración de
 * backtest en SQLite. POST valida (name ≤80 chars, ≤20 presets) y si el
 * nombre ya existe lo sobreescribe (el usuario corrigió su config).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidSymbolFormat } from "@/lib/providers/symbols";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESET_LIMIT = 20;

export async function GET() {
  try {
    const rows = await db.backtestPreset.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, name: true, config: true },
    });
    // El config se parsea para que el cliente lo aplique con un click.
    // Filas corruptas se filtran con warn (nunca datos fabricados al UI).
    const presets: {
      id: string;
      createdAt: Date;
      name: string;
      config: unknown;
    }[] = [];
    for (const row of rows) {
      try {
        presets.push({
          id: row.id,
          createdAt: row.createdAt,
          name: row.name,
          config: JSON.parse(row.config) as unknown,
        });
      } catch {
        console.warn(`Corrupt preset config for ${row.id}; skipped.`);
      }
    }
    return NextResponse.json({ presets });
  } catch (err) {
    console.error("GET /api/backtest/presets failed:", err);
    return NextResponse.json({ error: "Could not list presets." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    return NextResponse.json(
      { error: "Preset name is required (max 80 chars)." },
      { status: 400 },
    );
  }
  if (
    body.config == null ||
    typeof body.config !== "object" ||
    Array.isArray(body.config)
  ) {
    return NextResponse.json(
      { error: "Preset config object is required." },
      { status: 400 },
    );
  }
  const presetConfig = body.config as Record<string, unknown>;
  if (typeof presetConfig.symbol === "string") {
    // Chequeo liviano (la validación completa ocurre al correr el backtest).
    if (!isValidSymbolFormat(presetConfig.symbol.toUpperCase())) {
      return NextResponse.json(
        { error: "Preset config.symbol looks invalid." },
        { status: 400 },
      );
    }
  }

  try {
    const count = await db.backtestPreset.count();
    if (count >= PRESET_LIMIT) {
      return NextResponse.json(
        { error: `Preset limit reached (${PRESET_LIMIT}). Delete one first.` },
        { status: 400 },
      );
    }
    // Si el nombre ya existe, sobreescribe.
    await db.backtestPreset.deleteMany({ where: { name } });
    const row = await db.backtestPreset.create({
      data: { name, config: JSON.stringify(presetConfig) },
      select: { id: true },
    });
    return NextResponse.json({ id: row.id });
  } catch (err) {
    console.error("POST /api/backtest/presets failed:", err);
    return NextResponse.json({ error: "Could not save the preset." }, { status: 500 });
  }
}
