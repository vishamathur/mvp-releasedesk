import { NextResponse } from "next/server";
import { addDocument } from "@/lib/domain/application";
import type { DocumentType } from "@/lib/domain/types";
import { getApplication, saveApplication } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * MOCK document upload: accepts metadata only. No file bytes are persisted.
 * Real OCR / identity verification APIs are not called.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const existing = await getApplication(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = (await request.json()) as {
      type?: DocumentType;
      fileName?: string;
    };
    if (!body.type || !body.fileName) {
      return NextResponse.json(
        { error: "type and fileName are required (mock upload — no file bytes)" },
        { status: 400 },
      );
    }

    const application = addDocument(existing, {
      type: body.type,
      fileName: body.fileName,
    });
    await saveApplication(application);
    return NextResponse.json(
      {
        application,
        mock: {
          note: "Document upload is mocked. Filename recorded only; OCR summary is fabricated locally.",
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Document add failed" },
      { status: 400 },
    );
  }
}
