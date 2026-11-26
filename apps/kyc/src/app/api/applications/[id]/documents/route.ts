import { addDocument } from "@/lib/domain/application";
import type { DocumentType } from "@/lib/domain/types";
import { customerOwns, publicApplication } from "@/lib/access";
import { readJsonBody } from "@/lib/body";
import { authorize, bodyLimitResponse, configFailure, jsonError, NO_STORE } from "@/lib/gate";
import { getApplication, saveApplication } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const DOCUMENT_TYPES = new Set<DocumentType>([
  "passport",
  "national_id",
  "drivers_license",
  "proof_of_address",
  "selfie",
]);

/**
 * MOCK document upload: accepts metadata only. No file bytes are persisted.
 * Real OCR / identity verification APIs are not called.
 * Filenames are metadata. Do not send raw government ID numbers.
 */
export async function POST(request: Request, ctx: Ctx) {
  const limited = bodyLimitResponse(request);
  if (limited) return limited;
  const gate = await authorize(request, "customer");
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const existing = await getApplication(id);
  if (!existing || !customerOwns(existing, gate.actor)) {
    return jsonError("Not found", 404);
  }

  try {
    const body = (await readJsonBody(request)) as {
      type?: DocumentType;
      fileName?: string;
    };
    if (!body.type || !body.fileName || !DOCUMENT_TYPES.has(body.type)) {
      return jsonError("type and fileName are required (mock upload — no file bytes)", 400);
    }
    if (body.fileName.length > 120) {
      return jsonError("fileName must be at most 120 characters.", 400);
    }

    const application = addDocument(existing, {
      type: body.type,
      fileName: body.fileName,
    });
    await saveApplication(application);
    return NextResponse.json(
      {
        application: publicApplication(application),
        mock: {
          note: "Document upload is mocked. Filename recorded only; OCR summary is fabricated locally.",
        },
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (err) {
    const failure = configFailure(err);
    if (failure) return failure;
    return jsonError(err instanceof Error ? err.message : "Document add failed", 400);
  }
}
