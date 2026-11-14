export interface FileDownloadResult {
  requested: boolean;
  filename: string;
  byteLength: number;
}

/**
 * Triggers a browser file download using a temporary Blob URL.
 * Reports only that a browser download was requested ("Check your Downloads"),
 * without fabricating filesystem write confirmation.
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'application/octet-stream',
): FileDownloadResult {
  const blob = new Blob([content], { type: mimeType });
  const byteLength = blob.size;
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  return {
    requested: true,
    filename,
    byteLength,
  };
}

export function downloadJsonBundle(
  filename: string,
  payload: unknown,
): FileDownloadResult {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  return downloadTextFile(filename, json, 'application/json;charset=utf-8');
}

export function parseJsonSafe(
  rawText: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(rawText) };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not parse JSON file: ${err.message}`
          : 'Could not parse JSON file.',
    };
  }
}
