export async function downloadVercelState({ blobApi, token, pathname }) {
  const blob = await blobApi.get(pathname, {
    access: "private",
    useCache: false,
    token,
  });

  if (!blob?.stream) throw new Error(`Vercel Blob state not found: ${pathname}`);

  const text = await new Response(blob.stream).text();
  return {
    state: JSON.parse(text),
    metadata: {
      pathname: blob.pathname || pathname,
      size: blob.size ?? new TextEncoder().encode(text).byteLength,
      uploadedAt: blob.uploadedAt || null,
    },
  };
}
