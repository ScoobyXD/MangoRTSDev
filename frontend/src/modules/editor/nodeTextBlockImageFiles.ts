import { fetchMangoAttachmentBlob, fileFromDataURL } from "../attachments/attachmentApi.js";

export type TextBlockImageFileSource = {
  dataURL: string;
  attachmentID?: string;
  filename?: string;
  mimeType: string;
};

export async function prepareTextBlockImageFile(
  image: TextBlockImageFileSource,
  apiBase: string,
  companyID: string,
  fetchAttachmentBlob: typeof fetchMangoAttachmentBlob = fetchMangoAttachmentBlob,
): Promise<File | null> {
  const filename = image.filename?.trim() || "selected-image.png";
  const dataURLFile = fileFromDataURL(image.dataURL, filename);
  if (dataURLFile) return dataURLFile;

  let blob: Blob | null = null;
  const attachmentID = image.attachmentID?.trim() ?? "";
  if (attachmentID && apiBase.trim() && companyID.trim()) {
    blob = await fetchAttachmentBlob(apiBase, companyID, attachmentID, "original");
  } else if (image.dataURL.startsWith("blob:") && typeof fetch === "function") {
    const response = await fetch(image.dataURL);
    if (response.ok) blob = await response.blob();
  }
  if (!blob) return null;
  return new File([blob], filename, { type: blob.type || image.mimeType || "application/octet-stream" });
}
