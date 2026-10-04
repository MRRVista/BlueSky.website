// Blob helpers for AI Assistant attachments (kept separate so they can be stubbed in tests).
import { issueSignedToken, presignUrl, get, put, copy } from "@vercel/blob";

export const MAX_UPLOAD = 30 * 1024 * 1024;

// Short-lived URL the browser PUTs a file to; the function body cap doesn't apply.
export async function signUpload(pathname) {
  const tok = await issueSignedToken({ pathname, operations: ["put"], validUntil: Date.now() + 30 * 60e3, maximumSizeInBytes: MAX_UPLOAD });
  const { presignedUrl } = await presignUrl(tok, { operation: "put", pathname, access: "private", addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: MAX_UPLOAD });
  return presignedUrl;
}

export async function readBytes(pathname) {
  const r = await get(pathname, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) throw new Error("File not found.");
  return { bytes: Buffer.from(await new Response(r.stream).arrayBuffer()), contentType: r.blob && r.blob.contentType };
}

export async function copyBlob(from, to, contentType) {
  try {
    await copy(from, to, { access: "private", addRandomSuffix: false, contentType });
  } catch {
    const { bytes } = await readBytes(from);
    await put(to, bytes, { access: "private", addRandomSuffix: false, contentType });
  }
}
